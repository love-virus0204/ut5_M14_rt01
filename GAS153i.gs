/**
 * RT 外觀記錄表 GAS v1.5.2（POST-only，無欄位驗證）
 * 路由：submit|upsert（寫入）/ soft_delete（軟刪）/ list_recent（讀取）/ ping（心跳）
 * 鎖：ScriptLock，250ms 重試，10s 逾時
 * 欄位 A..U (1..21)：
 *  1 date(Date) 2 shift 3 part_no 4 lot 5 qty 6 sample_cnt
 *  7 z7 8 z8 9 z9 10 z10 11 z11 12 z12 13 z13
 * 14 inspector 15 remark
 * 16 submitted_at(Date, 後端產生) 17 key2(String) 18 key(String, 唯一)
 * 19 deleted("TRUE"/"FALSE") 20 admin_id(String) 21 deleted_at(Date)
 */

const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME     = 'Records';

/* 路由 */
function doGet(e){ return _json({status:"error", msg:"get_disabled"}); }

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

  // 寫入/軟刪：串列化
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

/* 寫入：命中 key 覆寫 1..18；未命中 appendRow（16、19..21 由後端補預設） */
function _submit(sheet, p){
  var row18 = [[
    new Date(p.date),     // 1
    p.shift,              // 2
    p.part_no,            // 3
    p.lot,                // 4
    p.qty,                // 5
    p.sample_cnt,         // 6
    p.z7,
    p.z8,
    p.z9,
    p.z10,
    p.z11,
    p.z12,
    p.z13,                // 7~13
    p.inspector,          // 14
    p.remark,             // 15
    new Date(),           // 16 submitted_at（後端產生）
    p.key2,               // 17
    p.key                 // 18
  ]];

  var hitRow = _findRowByKey(sheet, String(p.key));
  if (hitRow > 0){
    sheet.getRange(hitRow, 1, 1, 18).setValues(row18);
    return _json({status:"ok", mode:"更新"});
  } else {
    var v = row18[0];
    sheet.appendRow([...v,"TRUE"
    // 19 deleted, 20 admin_id, 21 deleted_at
    ]);
    return _json({status:"ok", mode:"新增"});
  }
}

/* 軟刪：只覆寫 18..21；16/17 不變；key 末尾補 |DEL */
function _softDelete(sheet, p){
  var row = Number(p.row_index||0);
  if (!row || row < 2 || row > sheet.getLastRow())
    return _json({status:"error", msg:"not_found"});

  var admin_id  = String(p.admin_id||"");
  var deletedAt = new Date();

  var oldKey = String(sheet.getRange(row, 18).getValue()||"");
  var newKey = oldKey.endsWith("|DEL") ? oldKey : (oldKey + "|DEL");

  sheet.getRange(row, 18, 1, 4).setValues([[
    newKey,      // 18 key
    "FALSE",     // 19 deleted（FALSE=失效）
    admin_id,    // 20 admin_id
    deletedAt    // 21 deleted_at
  ]]);
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
function _findRowByKey(sheet, key){
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var count = lastRow - 1;
  var keys  = sheet.getRange(2, 18, count, 1).getValues(); // 18=key
  for (var i=0;i<count;i++){
    if (String(keys[i][0]) === key) return i + 2;
  }
  return 0;
}