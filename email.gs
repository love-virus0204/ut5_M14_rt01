const TZ             = 'Asia/Taipei';
const SPREADSHEET_ID = '1AYD5Poy7DQmXw-QSHUkFUq0iT7TIxF76BpNilyPsz-U';
const SHEET_NAME     = 'Records';
// 自訂表題（對應 A..O）
const HEAD = [
  '日期','班別','料號','批號','批量PNL','批量Pcs','抽驗數',
  'PIN孔損壞','板邊或內槽分層或粗糙','板邊凸點(後處理板須更改程式)',
  '板面刮傷','漏銅','二次孔分層錫墊脫落','折斷邊摺痕、折斷',
  '檢驗員','備註'
];
const MAIL_TO        = 'nak.visu@gmail.com,hank-chen@pcbut.com.tw,mandy-li@pcbut.com.tw,weihao-hsu@pcbut.com.tw,yen-lo@pcbut.com.tw';

// const MAIL_TO = 'kiss216202@gmail.com';