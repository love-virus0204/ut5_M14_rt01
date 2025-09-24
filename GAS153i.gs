/**
 * RT 外觀記錄表 GAS v1.5.0 (POST-only, 硬限制, 移除 handleCORS)
 * submitted_at、deleted_at 由後端以 new Date() 寫入；不再接收前端值
 */
const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME = 'Records';

/* 路由 */
function doGet(e){ return _json({status:"error", msg:"get_disabled"}); }
function doPost(e) {
  if (!e || !e.postData) return _json({status: "error", msg: "no_post_data"});

  let p = {};
  if (e.postData.type === "application/json") {
    try {
      p = JSON.parse(e.postData.contents);
    } catch (err) {
      return _json({ status: "error", msg: "bad_json" });
    }
  } else {
    // 假設是 x-www-form-urlencoded 或 text/plain
    p = e.parameter;
  }

  const action = String(p.action || "").toLowerCase();
  if (!action) return _json({status:"error", msg:"unknown_action"});
  
  
  
  if (action==="list_recent") return _listRecent(sheet);
  if (action==="ping")        return _json({status:"ok"});

  if (action==="submit" || action==="upsert" || action==="soft_delete"){
    const lock = LockService.getScriptLock();
    const deadline = Date.now() + 10000; // 10 秒
    while (!lock.tryLock(250)) {
      if(Date.now()>deadline) return _json({status:"error", msg:"busy"});
    }
    try {
      return (action==="soft_delete") ? _softDelete(sheet, p) : _submit(sheet, p);
    } finally { lock.releaseLock(); }
  }
  return _json({status:"error", msg:"unknown_action"});
}

/* 寫入：submit/upsert */
function _submit(sheet, p){
  const submittedAt = new Date();
  const row18 = [[
    new Date(p.date),
    p.shift, p.part_no, p.lot, p.qty, p.sample_cnt,
    p.z7, p.z8, p.z9, p.z10, p.z11, p.z12, p.z13,
    p.inspector, p.remark,
    submittedAt, p.key2, p.key
  ]];
  const hitRow = _findRowByKey(sheet, String(p.key));
  if (hitRow > 0){
    sheet.getRange(hitRow, 1, 1, 18).setValues(row18);
    return _json({status:"ok", mode:"更新"});
  } else {
    const v=row18[0];
    sheet.appendRow([
      v[0],v[1],v[2],v[3],v[4],v[5],
      v[6],v[7],v[8],v[9],v[10],v[11],v[12],
      v[13],v[14],v[15],v[16],v[17],
      "TRUE","", ""
    ]);
    return _json({status:"ok", mode:"新增"});
  }
}

/* 軟刪：覆寫 18..21 */
function _softDelete(sheet, p){
  const row = Number(p.row_index||0);
  if (!row || row<2 || row>sheet.getLastRow())
    return _json({status:"error", msg:"not_found"});

  const admin_id = String(p.admin_id||"");
  const deletedAt = new Date();
  const oldKey = String(sheet.getRange(row, 18).getValue()||"");
  const newKey = oldKey.endsWith("|DEL") ? oldKey : (oldKey + "|DEL");

  sheet.getRange(row, 18, 1, 4).setValues([[newKey, "FALSE", admin_id, deletedAt]]);
  return _json({status:"ok"});
}

/* 讀取：底部 150 列 reverse */
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
function _findRowByKey(sheet, key){
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const keys = sheet.getRange(2, 18, lastRow-1, 1).getValues();
  for (var i=0;i<keys.length;i++){
    if (String(keys[i][0]) === key) return i + 2;
  }
  return 0;
}