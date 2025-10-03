/**
 * RT 外觀記錄表 GAS v1.5.3（無欄位驗證）
 * 路由：
 * backup（即時備份)
 * submit|upsert（寫入)
 * soft_delete（軟刪)
 * list_recent（讀取)
 * ping（心跳）
 * 欄位 A..U (1..21)：
 *  1 date
 *  2 shift 
 *  3 part_no 
 *  4 lot 
 *  5 qty 
 *  6 sample_cnt
 *  7 z7 
 *  8 z8 
 *  9 z9 
 *  10 z10 
 *  11 z11
 *  12 z12 
 *  13 z13
 *  14 inspector 
 *  15 remark
 *  16 submitted_at(系統時間|Asia/Taipei)
 *  17 key2
 *  18 key
 *  19 deleted("TRUE"/"FALSE")
 *  20 admin_id
 *  21 deleted_at(系統時間|Asia/Taipei) */

/*
const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME     = 'Records';
*/

/* 路由 */
function doGet(e){
  var p = (e && e.parameter) || {};
  var target = String(p.target || "");
  var payload = { status:"ok", msg:"get_disabled" }; // 只要能回
  if (!target) return _json(payload);
  var ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    payload.fileExists = true;
  } catch (_) {
    return _json(payload); // 檔案不在直回
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

  if (action === "ping") return _json({status:"ok"});
  var sheet = _sheet();
  if (!sheet) return _json({status:"error", msg:"sheet_not_found"});

  // 呼叫備份涵式｜該涵式已自鎖
if (action === "backup") {
  try {
    exportFilteredXlsxAndMail();
    return _json({status:"ok", msg:"backup_done"});
  } catch (err) {
    return _json({status:"error", msg:"backup_failed", detail:String(err)});
  }
}

// 讀表
  if (action === "list_recent") return _listRecent(sheet);

// 寫入/軟刪：加鎖
  if (action === "submit" || action === "upsert" || action === "soft_delete"){
    return withLock(60000, () => {
      if (action === "soft_delete") return _softDelete(sheet, p);
      return _submit(sheet, p);
    });
  }
    return _json({status:"error", msg:"unknown_action"});
  }

/* 寫入1..19：命中 key 覆寫 1..19
   - 維護一份一維 row，更新與新增共用；deleted 一律寫 "TRUE"
*/
function _submit(sheet, p){
  var submittedAt = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
  var row = [
    p.date,               //1
    p.shift,              //2
    p.part_no,            // 3
    p.lot,                // 4
    p.qty,                // 5
    p.sample_cnt,         // 6
    p.z07,                 // 7
    p.z08,                 // 8
    p.z09,                 // 9
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
    var last = sheet.getLastRow();
    sheet.getRange(last, 1).setNumberFormat('mm/dd');
    return _json({status:"ok", mode:"新增"});
  }
}

/* 軟刪：逐筆覆寫 18..21 ；key→"DEL" */
function _softDelete(sheet, p){
  var admin_id = String(p.admin_id || "");
  if (!admin_id) 
    return _json({status:"error", msg:"no_admin_id"});
  var lastRow = sheet.getLastRow();
  var targets = [];
  for (var k in p){
    if (/^row\d+$/.test(k)) {
      var r = Number(p[k]);
      if (r && r >= 2 && r <= lastRow) targets.push(r);
    }
  }
  if (targets.length === 0) 
    return _json({status:"error", msg:"not_found"});

  var deletedAt = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
  var rowValue  = ["DEL", "FALSE", admin_id, deletedAt]; // 1×4

  for (var i = 0; i < targets.length; i++){
    sheet.getRange(targets[i], 18, 1, 4).setValues([rowValue]);
  }
  return _json({status:"ok", count: targets.length});
}

/* 讀取：取底部 150 列，依第16欄 降冪，回傳 fields+values */
function _listRecent(sheet){
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return _json({status:"error", msg:"no_data"});
  }

  var lastCol  = sheet.getLastColumn() - 2;
  var startRow = Math.max(2, lastRow - 150 + 1);
  var rows     = lastRow - startRow + 1;

  var values = sheet.getRange(startRow, 1, rows, lastCol).getValues();

  const epoch = Date.UTC(1899,11,30);
  values.forEach(function(row, i){
    row[0] = _toSerialInt(row[0], epoch);
    row.push(startRow + i);
  });
  //values.reverse(); // 由新到舊
  //依第16欄 submitted_at (index=15) 降冪
  values.sort(function(a,b){ return b[15] - a[15]; });
  // values.sort(function(a,b){
  //    return String(b[15]).localeCompare(String(a[15]));
  //});

  var fields = [
"date","shift","part_no","lot","qty","sample_cnt",
"z07","z08","z09","z10","z11","z12","z13",
"inspector","remark","submitted_at","key2","key","deleted","row"];

  return _json({
    status: "ok", fields: fields, values: values
  });
}

/* 工具 */
function _sheet(){
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss ? ss.getSheetByName(SHEET_NAME) : null;
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

/*** 日期序號轉換（Excel 基準：1899-12-30） ***/
function _toSerialInt(v, epoch){
  if (typeof v === "number") return Math.floor(v);
  if (Object.prototype.toString.call(v) === "[object Date]"){
    return Math.floor((v.getTime() - epoch) / 86400000);
  }
  return 0;
}

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}