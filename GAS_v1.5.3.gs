/**
 * RT 外觀記錄表 GAS v1.5.3（POST-only，無欄位驗證）
 * 路由：submit|upsert（寫入）/ soft_delete（軟刪）/ list_recent（讀取）/ ping（心跳）
 * 鎖：ScriptLock，250ms 重試，10s 逾時
 * 欄位 A..U (1..21)：
 *  1 date(前端提供；可為序號或字串) 2 shift 3 part_no 4 lot 5 qty 6 sample_cnt
 *  7 z7 8 z8 9 z9 10 z10 11 z11 12 z12 13 z13
 * 14 inspector 15 remark
 * 16 submitted_at(String, 以 Asia/Taipei 格式化的系統時間) 17 key2(String) 18 key(String, 唯一)
 * 19 deleted("TRUE"/"FALSE") 20 admin_id(String) 21 deleted_at(String, Asia/Taipei)
 */

const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME     = 'Records';

/* 路由 */
function doGet(e){
  var p = (e && e.parameter) || {};
  var target = String(p.target || "");
  var payload = { status:"ok", msg:"get_disabled" }; // 只要能回就是活著
  if (!target) return _json(payload);
  var ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    payload.fileExists = true;
  } catch (_) {
    return _json(payload); // 檔案不存在就直接回，不崩潰
  }
  var found = ss.getSheets().some(function(sh){ return sh.getName() === SHEET_NAME; });
  if (found) payload.sheetExists = true;
  return _json(payload);
}

function doPost(e){
  if (!e || !e.postData) return _json({status:"error", msg:"no_post_data"});

  // 解析：JSON 優先，否則 x-www-form-urlencoded（e.parameter）
  var p = {};
  try {
    if (e.postData.type === 'application/json') {
      p = JSON.parse(e.postData.contents || "{}");
    } else {
      p = e.parameter || {};
    }
  } catch (_){
    return _json({status:"error", msg:"bad_json"});
  }

  var action = String(p.action||"").toLowerCase();
  if (!action) return _json({status:"error", msg:"unknown_action"});

  var sheet = _sheet();
  if (!sheet) return _json({status:"error", msg:"sheet_not_found"});

  // 讀取路徑
  if (action === "list_recent") return _listRecent(sheet);
  if (action === "ping")        return _json({status:"ok"});

  // 寫入/軟刪：加鎖
  if (action === "submit" || action === "upsert" || action === "soft_delete"){
    var lock = LockService.getScriptLock();
    var deadline = Date.now() + 10000; // 10s
    while (!lock.tryLock(250)) {
      if (Date.now() > deadline) return _json({status:"error", msg:"busy"});
    }
    try {
      if (action === "soft_delete") return _softDelete(sheet, p);
      return _submit(sheet, p);
    } finally {
      lock.releaseLock();
    }
  }

  return _json({status:"error", msg:"unknown_action"});
}

/* 寫入1..19：命中 key 覆寫 1..19
   依需求：
   - 維護一份一維 row，更新與新增共用；deleted 一律寫 "TRUE"
*/
function _submit(sheet, p){
  var submittedAt = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  // 一維列資料（1..19）
  var row = [
    p.date,               // 1
    p.shift,              // 2
    p.part_no,            // 3
    p.lot,                // 4
    p.qty,                // 5
    p.sample_cnt,         // 6
    p.z7,                 // 7
    p.z8,                 // 8
    p.z9,                 // 9
    p.z10,                // 10
    p.z11,                // 11
    p.z12,                // 12
    p.z13,                // 13
    p.inspector,          // 14
    p.remark,             // 15
    submittedAt,          // 16
    p.key2,               // 17
    p.key,                // 18
    "TRUE"                // 19
  ];

  var hitRow = _findRowByKey(sheet, String(p.key));
  if (hitRow > 0){
    sheet.getRange(hitRow, 1, 1, 19).setValues([row]); // 覆寫 1..19
    return _json({status:"ok", mode:"更新"});
  } else {
    sheet.appendRow([...row, "", ""]);
    return _json({status:"ok", mode:"新增"});
  }
}

/* 軟刪：只覆寫 18..21；16/17 不變；key 直接改為 "DEL" */
function _softDelete(sheet, p){
  var row = Number(p.row_index||0);
  if (!row || row < 2 || row > sheet.getLastRow())
    return _json({status:"error", msg:"not_found"});

  var admin_id   = String(p.admin_id||"");
  var deletedAt  = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');

  sheet.getRange(row, 18, 1, 4).setValues([
    ["DEL", "FALSE", admin_id, deletedAt]]);
  return _json({status:"ok"});
}

/* 讀取：取底部 150 列，reverse，回全欄＋row_index */
function _listRecent(sheet){
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return _json({status:"error", msg:"no_data"});
  var lastCol  = sheet.getLastColumn();
  var startRow = Math.max(2, lastRow - 150 + 1);
  var rows     = lastRow - startRow + 1;

  var values = sheet.getRange(startRow, 1, rows, lastCol).getValues();
  values.reverse();

  var data = values.map(function(r, i){
    return {
      row_index: lastRow - i,
      date: r[0], shift: r[1], part_no: r[2], lot: r[3], qty: r[4], sample_cnt: r[5],
      z7: r[6], z8: r[7], z9: r[8], z10: r[9], z11: r[10], z12: r[11], z13: r[12],
      inspector: r[13], remark: r[14],
      submitted_at: r[15], key2: r[16], key: r[17],
      deleted: r[18], admin_id: r[19], deleted_at: r[20]
    };
  });
  return _json(data);
}

/* 工具 */
function _sheet(){
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss ? ss.getSheetByName(SHEET_NAME) : null;
}
function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}