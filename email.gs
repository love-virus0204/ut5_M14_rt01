function exportFilteredXlsxAndMail(){
  return withLock(60000, () => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) throw new Error('找不到工作表：' + SHEET_NAME);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    // 一次讀全表（顯示值）
    const all = sh.getRange(1, 1, lastRow, 21).getDisplayValues();

    // 1) 最新月份與同月資料（A..O 且 deleted=TRUE）
    const latestKey = Number(all[lastRow - 1][16]); // 第17欄 key2
    let topIdxLatest = 1;
    const rows = [];
    for (let i = lastRow - 1; i >= 1; i--) {
      const k = Number(all[i][16]);
      if (k !== latestKey) { topIdxLatest = i + 1; break; }
      if (all[i][18] === 'TRUE') rows.push(all[i].slice(0, 15));
    }
    if (!rows.length) return;

  rows = rows.map(row => {
    const v = String(row[5]);
    const isPcs = v.endsWith('Pcs');
    const base  = v.slice(0, -3);
    row.splice(6, 0, isPcs ? base : '');
    row[5] = isPcs ? '' : base;
    return row;
  });
    rows.push(HEAD);
    const out = rows.reverse();

    // 2) 暫存表：名稱唯一；Sheet 名=mm；附件/主旨=yyyy-mm
    const yyyymm = String(latestKey);
    const yyyy = yyyymm.slice(0,4), mm = yyyymm.slice(4,6);
    const subject = `${yyyy}-${mm} Rt外觀記錄表`;
    const fname   = `${subject}.xlsx`;

    const tmp = SpreadsheetApp.create(`TMP_${yyyy}${mm}_${Date.now()}`);
    const tsh = tmp.getSheets()[0];
    tsh.setName(mm);
    tsh.getRange(1, 1, out.length, HEAD.length).setValues(out);
    SpreadsheetApp.flush();
    Utilities.sleep(3000);

    try {
      const xlsx = fetchXlsxWithRetry_(tmp.getId(), fname); // 重試在此涵式
      MailApp.sendEmail({ to: MAIL_TO, subject, body: '如題', attachments: [xlsx] });

      // 3) 寄件成功後才清理；若最新月 < 202501 直接跳過刪除
      if (latestKey < 202501) return;

      const cutoff = latestKey - 2; // 保留三個月
      let cutIdx = -1;
      for (let i = topIdxLatest; i >= 1; i--) {
        if (Number(all[i][16]) < cutoff) { cutIdx = i; break; }
      }
      if (cutIdx > 0) {
        sh.deleteRows(2, cutIdx);
      }
    } catch (err) {
      const why = String(err && err.message ? err.message : err);
      const errSubject = `eor_${subject}`;
      const body =
`系統無法彙整並寄出 XLSX。
原因：
- ${why}

可能情況：
- Google Drive 匯出延遲或流量限制
- 檔案索引未完成
- 權限或網路暫時性錯誤

請通知開發人員檢查。此信為自動通知。`;
      MailApp.sendEmail({ to: MAIL_TO, subject: errSubject, body });
    } finally {
      try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (_) {}
    }
  });
}


function fetchXlsxWithRetry_(fileId, fname){
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const delays = [2000, 3000, 5000, 10000, 15000];
  let lastErr;

  for (let i = 0; i < delays.length; i++){
    try {
      const resp = UrlFetchApp.fetch(url, { headers, muteHttpExceptions: true });
      const code = resp.getResponseCode();
      if (code >= 200 && code < 300) {
        const blob = resp.getBlob().setName(fname);
        const ct = blob.getContentType();
        if (ct !== MimeType.MICROSOFT_EXCEL) lastErr = new Error(`Unexpected content type: ${ct}`);
        else return blob;
      } else {
        lastErr = new Error('Export HTTP ' + code);
      }
    } catch(e){ lastErr = e; }
    Utilities.sleep(delays[i]);
  }
  throw lastErr;
}