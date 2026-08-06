// 消費者登入驗證 — 以「手機號碼」為帳號、「PIN」為密碼。
// PIN 以 scrypt + 每人隨機鹽雜湊後存於 Patient（永不存明碼）；驗證採固定時間比較。
// 全程使用 Node 內建 node:crypto，無額外相依。
//
// 註：PIN 僅 4–6 位數字，屬於展示等級的便民驗證；正式部署應再加上
//     登入失敗鎖定（如連續 5 次鎖 15 分鐘）與簡訊 OTP 等強化措施。
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// 正規化手機號碼：去除空白、括號與連字號（保留前導 +）。
// 例：'0912-345 678' → '0912345678'、'+886 912 345 678' → '+886912345678'
export function normalizePhone(phone) {
  return String(phone ?? '').trim().replace(/[\s()-]/g, '');
}

// 產生 6 位數字 PIN（不足補零）。
export function generatePin() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

// 是否為合法 PIN（4–6 位純數字）。
export function isValidPin(pin) {
  return /^\d{4,6}$/.test(String(pin ?? ''));
}

// 雜湊 PIN → "saltHex:hashHex"。
export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// 驗證 PIN 是否與雜湊相符（固定時間比較，避免時序側錄）。
export function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = scryptSync(String(pin), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
