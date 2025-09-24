/**
 * RT 外觀記錄表 GAS v1.5.0 (POST-only, 硬限制)
 * 變更：submitted_at、deleted_at 由後端以 new Date() 寫入；不再接收前端值
 * 流程：submit|upsert(寫入) / soft_delete(軟刪) / list_recent(讀取) / ping(心跳)
 * 鎖：DocumentLock，250ms 重試，10s 逾時
 * 欄位 A..U（1..21）：
 * 1 date(Date) 2 shift 3 part_no 4 lot 5 qty 6 sample_cnt
 * 7 z7 8 z8 9 z9 10 z10 11 z11 12 z12 13 z13
 * 14 inspector 15 remark
 * 16 submitted_at(Date) 17 key2(String) 18 key(String, 唯一)
 * 19 deleted(String "TRUE"/"FALSE") 20 admin_id(String) 21 deleted_at(Date)
 * 規則：
 * - 寫入：命中 key → 覆寫 1..18；未命中 → appendRow([1..18,"TRUE","",""])
 * - 軟刪：只改 18..21 = [ key|DEL, "FALSE", admin_id, deleted_at(new Date()) ]；16/17 不改
 * - 讀取：無資料 → {status:"error", msg:"no_data"}；否則取底部 150 列並 reverse()
 * - 無額外防呆、不檢查表頭
 */
const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME = 'Records';

// 新增：CORS 處理函數
function handleCORS() {
  return ContentService.createTextOutput(JSON.stringify({status: "ok"}))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}
/* 路由 */
function doGet(e){ return _json({status:"error", msg:"get_disabled"}); }
function doPost(e){
  if (!e || !e.postData || !e.postData.contents) return _json({status:"error", msg:"no_post_data"});
  const sheet = _sheet(); if (!sheet) return _json({status:"error", msg:"sheet_not_found"});
  let p={}; try{ p=JSON.parse(e.postData.contents||"{}"); }catch(_){ return _json({status:"error", msg:"bad_json"}); }
  const action = String(p.action||"").toLowerCase(); if (!action) return _json({status:"error", msg:"unknown_action"});

  if (action==="list_recent") return _listRecent(sheet);
  if (action==="ping")        return _json({status:"ok"});

  if (action==="submit" || action==="upsert" || action==="soft_delete"){
    const lock = LockService.getDocumentLock();
    const deadline = Date.now()+10000;
    while(!lock.tryLock(250)){ if(Date.now()>deadline) return _json({status:"error", msg:"busy"}); }
    try { return (action==="soft_delete") ? _softDelete(sheet, p) : _submit(sheet, p); }
    finally { lock.releaseLock(); }
  }
  return _json({status:"error", msg:"unknown_action"});
}

/* 寫入：submit/upsert（submitted_at 後端自產） */
function _submit(sheet, p){
  const submittedAt = new Date(); // 16 欄寫入 Date 物件
  const row18 = [[
    new Date(p.date),           // 1
    p.shift,                    // 2
    p.part_no,                  // 3
    p.lot,                      // 4
    p.qty,                      // 5
    p.sample_cnt,               // 6
    p.z7, p.z8, p.z9,           // 7..9
    p.z10, p.z11, p.z12, p.z13, // 10..13
    p.inspector,                // 14
    p.remark,                   // 15
    submittedAt,                // 16 (後端)
    p.key2,                     // 17
    p.key                       // 18
  ]];

  const hitRow = _findRowByKey(sheet, String(p.key));
  if (hitRow > 0){
    sheet.getRange(hitRow, 1, 1, 18).setValues(row18); // 覆寫 1..18
    return _json({status:"ok", mode:"更新"});
  } else {
    const v=row18[0];
    sheet.appendRow([
      v[0],v[1],v[2],v[3],v[4],v[5],
      v[6],v[7],v[8],v[9],v[10],v[11],v[12],
      v[13],v[14],
      v[15],v[16],v[17],
      "TRUE","", ""
    ]);
    return _json({status:"ok", mode:"新增"});
  }
}

/* 軟刪：只覆寫 18..21；16/17 不改；deleted_at 後端自產 */
function _softDelete(sheet, p){
  const row = Number(p.row_index||0);
  if (!row || row<2 || row>sheet.getLastRow()) return _json({status:"error", msg:"not_found"});

  const admin_id = String(p.admin_id||"");
  const deletedAt = new Date(); // 21 欄寫入 Date 物件

  const oldKey = String(sheet.getRange(row, 18).getValue()||""); // 18=key
  const newKey = oldKey.endsWith("|DEL") ? oldKey : (oldKey + "|DEL");

  sheet.getRange(row, 18, 1, 4).setValues([
    [ newKey, "FALSE", admin_id, deletedAt ]
  ]);

  return _json({status:"ok"});
}

/* 讀取：底部 150 列，reverse，回全欄＋row_index */
function _listRecent(sheet){
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return _json({status:"error", msg:"no_data"});

  const lastCol = sheet.getLastColumn();
  const startRow = Math.max(2, lastRow - 150 + 1);
  const rows = lastRow - startRow + 1;

  const values = sheet.getRange(startRow, 1, rows, lastCol).getValues();
  values.reverse();

  const data = values.map((r, i) => ({
    row_index: lastRow - i,
    date: r[0], shift: r[1], part_no: r[2], lot: r[3], qty: r[4], sample_cnt: r[5],
    z7: r[6], z8: r[7], z9: r[8], z10: r[9], z11: r[10], z12: r[11], z13: r[12],
    inspector: r[13], remark: r[14],
    submitted_at: r[15], key2: r[16], key: r[17],
    deleted: r[18], admin_id: r[19], deleted_at: r[20]
  }));
  return _json(data);
}

/* 工具 */
function _sheet(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss ? ss.getSheetByName(SHEET_NAME) : null;
}
function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
/* 以第18欄(key)建立索引並尋找列 */
function _findRowByKey(sheet, key){
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const count = lastRow - 1;
  const keys = sheet.getRange(2, 18, count, 1).getValues(); // 18=key
  for (var i=0;i<count;i++){
    if (String(keys[i][0]) === key) return i + 2; // 2..lastRow
  }
  return 0;
}