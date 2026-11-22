/**
 * PANZER+SHOP — Backend API (Google Apps Script)
 *
 * ก่อนใช้งาน:
 *  1) Project Settings → Script Properties → เพิ่ม ADMIN_USER และ ADMIN_PASS (ตั้งรหัสใหม่ที่เดายาก)
 *  2) รันฟังก์ชัน authorizeOnce() หนึ่งครั้งเพื่อกดอนุญาตสิทธิ์
 *  3) Deploy → New deployment → Web app → Execute as: Me / Who has access: Anyone
 */

const SHEET_ID = '1rea29NllhQv4OKg3QC9fegfwxG4km8X5rwDVd-sPqL4';
const SHEET_NAME = 'Products';
const IMAGE_FOLDER_NAME = 'PanzerShop Images';
const TOKEN_TTL = 6 * 60 * 60; // อายุ token 6 ชั่วโมง (วินาที)
const MAX_IMAGE_CHARS = 7 * 1024 * 1024; // ขนาด base64 สูงสุดโดยประมาณ

const ALLOWED_CATEGORIES = ['Tanks', 'Aircraft', 'Warships', 'Cars' ,  'Figure', 'Robot', 'Others'];
const ALLOWED_STATUSES = ['In Stock', 'Hot', 'Out of Stock'];

// ---------------- Entry points ----------------

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action === 'getProducts') {
      return json_({ success: true, products: getProducts_() });
    }
    return json_({ success: true, message: 'PANZER+SHOP API is running' });
  } catch (err) {
    return json_({ success: false, message: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'login':
        return json_(login_(body.username, body.password));
      case 'logout':
        logout_(body.token);
        return json_({ success: true });
      case 'addProduct':
        requireAdmin_(body.token);
        return json_(addProduct_(body.product, body.image, body.fileName));
      case 'deleteProduct':
        requireAdmin_(body.token);
        return json_(deleteProduct_(body.id));
      default:
        return json_({ success: false, message: 'Unknown action' });
    }
  } catch (err) {
    return json_({ success: false, message: err.message || String(err), code: err.code || '' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------- Auth ----------------

function login_(username, password) {
  const props = PropertiesService.getScriptProperties();
  const u = props.getProperty('ADMIN_USER');
  const p = props.getProperty('ADMIN_PASS');
  if (!u || !p) {
    return { success: false, message: 'ยังไม่ได้ตั้งค่า ADMIN_USER / ADMIN_PASS ใน Script Properties' };
  }
  if (username === u && password === p) {
    const token = Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put('tok_' + token, '1', TOKEN_TTL);
    return { success: true, token: token };
  }
  Utilities.sleep(800); // ชะลอการเดารหัสผ่าน
  return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('tok_' + token);
}

function requireAdmin_(token) {
  if (!token || !CacheService.getScriptCache().get('tok_' + token)) {
    const err = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    err.code = 'AUTH';
    throw err;
  }
}

// ---------------- Products ----------------

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบชีตชื่อ "' + SHEET_NAME + '"');
  return sheet;
}

function getProducts_() {
  const data = getSheet_().getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const products = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] === '' || row[0] === null) continue; // ข้ามแถวว่าง
    const product = {};
    for (let j = 0; j < headers.length; j++) {
      product[headers[j]] = row[j];
    }
    product.id = String(row[0]);
    products.push(product);
  }
  return products;
}

function clean_(value, maxLen) {
  let s = String(value === undefined || value === null ? '' : value).trim().slice(0, maxLen || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // กัน formula injection ในชีต
  return s;
}

function addProduct_(product, base64Image, fileName) {
  if (!product) throw new Error('ไม่มีข้อมูลสินค้า');
  const name = clean_(product.ProductName, 150);
  const price = Number(product.Price);
  if (!name) throw new Error('กรุณาระบุชื่อสินค้า');
  if (isNaN(price) || price < 0) throw new Error('ราคาไม่ถูกต้อง');
  if (ALLOWED_CATEGORIES.indexOf(product.Category) === -1) throw new Error('หมวดหมู่ไม่ถูกต้อง');
  if (ALLOWED_STATUSES.indexOf(product.Status) === -1) throw new Error('สถานะไม่ถูกต้อง');

  let imageUrl = '';
  if (base64Image) {
    imageUrl = uploadImage_(base64Image, fileName);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const id = new Date().getTime().toString();
    getSheet_().appendRow([
      id,
      name,
      product.Category,
      clean_(product.Scale, 20),
      clean_(product.Brand, 50),
      price,
      product.Status,
      imageUrl
    ]);
    return { success: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function deleteProduct_(id) {
  if (!id) throw new Error('ไม่พบรหัสสินค้า');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    for (let i = 1; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    throw new Error('ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)');
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Images ----------------

function uploadImage_(base64Data, filename) {
  if (typeof base64Data !== 'string' || base64Data.indexOf('data:image/') !== 0) {
    throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
  }
  if (base64Data.length > MAX_IMAGE_CHARS) {
    throw new Error('ไฟล์รูปใหญ่เกินไป');
  }

  let folder;
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(IMAGE_FOLDER_NAME);
  }

  const parts = base64Data.split(',');
  const type = parts[0].split(';')[0].replace('data:', '');
  const bytes = Utilities.base64Decode(parts[1]);
  const safeName = String(filename || 'image').replace(/[^\w.\-]/g, '_').slice(0, 80);
  const blob = Utilities.newBlob(bytes, type, safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

// ---------------- Helper: รันครั้งเดียวเพื่ออนุญาตสิทธิ์ ----------------

function authorizeOnce() {
  Logger.log(SpreadsheetApp.openById(SHEET_ID).getName());
  Logger.log(DriveApp.getRootFolder().getName());
  CacheService.getScriptCache().put('ping', '1', 10);
  Logger.log('Authorized OK');
}
function checkProps() {
  const p = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify(Object.keys(p)));
  Logger.log('user length: ' + (p.ADMIN_USER || '').length + ', pass length: ' + (p.ADMIN_PASS || '').length);
}
