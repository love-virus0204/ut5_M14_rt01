/**
* RT 外觀記錄表 GAS v1.5.2 (支援 x-www-form-urlencoded)
*/

const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME = 'Records';

/* 路由 */
function doGet(e){ return _json({status:"error", msg:"get_disabled"}); }

function doPost(e){
  if (!e || !e.postData || !e.postData.contents) return _json({status:"error", msg:"no_post_data"});
  
  const sheet = _sheet(); if (!sheet) return _json({status:"error", msg:"sheet_not_found"});
  
  let p = {};
  try {
    // 處理 x-www-form-urlencoded
    if (e.postData.type === 'application/x-www-form-urlencoded') {
      p = _parseFormData(e.postData.contents);
    } else {
      // 原有的 JSON 處理（保持向後兼容）
      p = JSON.parse(e.postData.contents || "{}");
    }
  } catch(error) {
    return _json({status:"error", msg:"bad_data", error: error.toString()});
  }
  
  const action = String(p.action || "").toLowerCase();
  if (!action) return _json({status:"error", msg:"unknown_action"});

  if (action === "list_recent") return _listRecent(sheet);
  if (action === "ping") return _json({status:"ok"});

  if (action === "submit" || action === "upsert" || action === "soft_delete"){
    const lock = LockService.getDocumentLock();
    const deadline = Date.now() + 10000;
    while (!lock.tryLock(250)) {
      if (Date.now() > deadline) return _json({status:"error", msg:"busy"});
    }
    try {
      return (action === "soft_delete") ? _softDelete(sheet, p) : _submit(sheet, p);
    } finally {
      lock.releaseLock();
    }
  }
  
  return _json({status:"error", msg:"unknown_action"});
}

/* 解析 x-www-form-urlencoded 數據 */
function _parseFormData(formDataString) {
  const params = {};
  const pairs = formDataString.split('&');
  
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split('=');
    if (pair.length === 2) {
      const key = decodeURIComponent(pair[0]);
      const value = decodeURIComponent(pair[1].replace(/\+/g, ' '));
      params[key] = value;
    }
  }
  
  return params;
}

/* 寫入：submit/upsert */
function _submit(sheet, p) {
  const submittedAt = new Date();
  
  const row18 = [[
    new Date(p.date),
    p.shift,
    p.part_no,
    p.lot,
    p.qty,
    p.sample_cnt,
    p.z7 || 0, 
    p.z8 || 0,
    p.z9 || 0,
    p.z10 || 0,
    p.z11 || 0,
    p.z12 || 0,
    p.z13 || 0,
    p.inspector,
    p.remark || "",
    submittedAt,
    p.key2,
    p.key
  ]];

  const hitRow = _findRowByKey(sheet, String(p.key));
  if (hitRow > 0) {
    sheet.getRange(hitRow, 1, 1, 18).setValues(row18);
    return _json({status: "ok", mode: "更新"});
  } else {
    const v = row18[0];
    sheet.appendRow([
      ...v, "TRUE"
    ]);
    return _json({status: "ok", mode: "新增"});
  }
}

/* 軟刪 */
function _softDelete(sheet, p) {
  const row = Number(p.row_index || 0);
  if (!row || row < 2 || row > sheet.getLastRow()) return _json({status: "error", msg: "not_found"});

  const admin_id = String(p.admin_id || "");
  const deletedAt = new Date();

  const oldKey = String(sheet.getRange(row, 18).getValue() || "");
  const newKey = oldKey.endsWith("|DEL") ? oldKey : (oldKey + "|DEL");

  sheet.getRange(row, 18, 1, 4).setValues([
    [newKey, "FALSE", admin_id, deletedAt]
  ]);

  return _json({status: "ok"});
}

/* 讀取 */
function _listRecent(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return _json({status: "error", msg: "no_data"});

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

/* 工具函數 */
function _sheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss ? ss.getSheetByName(SHEET_NAME) : null;
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _findRowByKey(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const count = lastRow - 1;
  const keys = sheet.getRange(2, 18, count, 1).getValues();
  
  for (var i = 0; i < count; i++) {
    if (String(keys[i][0]) === key) return i + 2;
  }
  
  return 0;
}