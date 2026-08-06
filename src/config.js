// 健康幣 HealthVault — 系統設定與 FHIR 命名常數
// 所有可調參數皆可由環境變數覆寫（見 .env.example）。
// 經濟模型的預設值取自企劃書〈附錄：規則速查〉與〈6.1 發幣與消費規則〉。
// FHIR_BASE_URL 為必填（無預設值）；其餘參數皆有合理預設。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 極簡 .env 載入器（無相依套件，不需安裝 dotenv）─────────────────
// 讀取專案根目錄的 .env，逐行解析 KEY=VALUE：
//   - 跳過空行與整行註解（以 # 開頭的行）
//   - 去除值前後空白與成對引號；未加引號的值移除行內註解（空白後的 #…）
//   - 已存在於 process.env 的變數優先，不覆寫（方便用真實環境變數蓋過 .env）
// 找不到 .env（或讀取失敗）時靜默略過——必填項由各進入點啟動時自行把關。
(function loadDotEnv() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const text = readFileSync(path.join(root, '.env'), 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue; // 空行與整行註解
      const eq = line.indexOf('=');
      if (eq < 1) continue; // 無 KEY 或缺少 = 的行一律略過
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1); // 去除成對引號（保留引號內的 #）
      } else {
        const inlineComment = value.search(/\s#/); // 未加引號值的行內註解
        if (inlineComment !== -1) value = value.slice(0, inlineComment).trim();
      }
      if (!(key in process.env)) process.env[key] = value; // 已存在者優先
    }
  } catch {
    // 無 .env 檔或讀取失敗 → 略過，交由 server.js / seed.js 檢查必填項
  }
})();

export const config = {
  // 後端服務埠（預設 3100，與幼兒園專案的 3000 區隔，可同時啟動）
  port: Number(process.env.PORT || 3100),

  // 目標 FHIR 伺服器（必填，無預設值）。請以環境變數或根目錄 .env 設定 FHIR_BASE_URL，
  // 例如慈濟測試站 https://tzuchi-fhir.ddns.net/fhir 或公開的 https://hapi.fhir.org/baseR4。
  // 未設定時為空字串，server.js / scripts/seed.js 會於啟動時報錯並中止（exit 1）。
  fhirBaseUrl: (process.env.FHIR_BASE_URL || '').replace(/\/+$/, ''),

  // 租戶標記：公開／共用伺服器上以 meta.tag + _tag 過濾，確保只讀寫本平台資料。
  // 多人共用同一伺服器時，請改成獨一無二的字串（例如加上學號）。
  tenantTag: process.env.TENANT_TAG || 'healthvault-demo',

  // 健康幣顯示用單位
  coinUnitLabel: process.env.COIN_UNIT_LABEL || '健康幣',

  // ── 發幣規則（企劃書 6.1 / 附錄）──────────────────────────────
  stepsPerCoin: Number(process.env.STEPS_PER_COIN || 1000), // 1,000 步 = 1 幣（無條件捨去）
  aerobicWeight: Number(process.env.AEROBIC_WEIGHT || 1.2), // 有氧達標加權（上限 1.2）
  aerobicHrMin: Number(process.env.AEROBIC_HR_MIN || 90), // 有氧心率區間下限（bpm）
  aerobicHrMax: Number(process.env.AEROBIC_HR_MAX || 160), // 有氧心率區間上限（bpm）
  dailyEarnCap: Number(process.env.DAILY_EARN_CAP || 50), // 單日發幣上限
  dailySpendCap: Number(process.env.DAILY_SPEND_CAP || 100), // 單日消費上限（靜態載具止損線）

  // ── 防偽門檻 ──────────────────────────────────────────────
  // 單次同步步數 > 15,000 步/小時 視為異常並拒絕（搖手機神器／外掛）
  antiFraudStepsPerHour: Number(process.env.ANTI_FRAUD_STEPS_PER_HOUR || 15000),
  // 即時手機同步未提供時間窗時，保守假設的時間窗（小時）
  defaultSyncWindowHours: Number(process.env.DEFAULT_SYNC_WINDOW_HOURS || 1),

  // 管理／發卡端登入密碼（註冊使用者與總覽需授權；消費者/Kiosk/POS 端為展示方便免登入）
  adminPassword: process.env.ADMIN_PASSWORD || 'health1234',
};

// FHIR 命名系統（identifier / coding / extension 的 system URL）
export const SYSTEMS = {
  tenant: 'http://healthvault.tw/fhir/tenant',
  // 虛擬錢包 UUID：同時掛在 Patient 與 Account 上作為對外識別（關聯阻斷：對商戶只露 UUID）
  walletId: 'http://healthvault.tw/fhir/wallet-id',
  wristband: 'http://healthvault.tw/fhir/wristband-uid', // 無手機長者的手環 UID（Kiosk 代同步用）
  phone: 'http://healthvault.tw/fhir/phone', // 使用者手機號碼（消費者 App 登入帳號）
  txnType: 'http://healthvault.tw/fhir/txn-type', // 帳本交易類別 earn/spend/adjust
  obsCategory: 'http://healthvault.tw/fhir/observation-category',
  idempotency: 'http://healthvault.tw/fhir/idempotency-key', // 冪等鍵（杜絕重複入帳/重複扣款）
  coin: 'http://healthvault.tw/fhir/coin', // valueQuantity 的健康幣單位 system
  item: 'http://healthvault.tw/fhir/health-item', // 健康物資品項代碼
};

// 自訂 extension（承載快取餘額、每日計數與交易明細）
export const EXT = {
  balance: 'http://healthvault.tw/fhir/ext/balance', // Account 快取餘額（決策一律以帳本重算為準）
  dailyEarned: 'http://healthvault.tw/fhir/ext/daily-earned',
  dailySpent: 'http://healthvault.tw/fhir/ext/daily-spent',
  dailySteps: 'http://healthvault.tw/fhir/ext/daily-steps',
  dailyDate: 'http://healthvault.tw/fhir/ext/daily-date',
  frozenReason: 'http://healthvault.tw/fhir/ext/frozen-reason',
  txnDetail: 'http://healthvault.tw/fhir/ext/txn-detail', // 帳本明細 JSON（商戶/品項/步數/加權）
  stepDetail: 'http://healthvault.tw/fhir/ext/step-detail', // 步數憑證明細 JSON
  pinHash: 'http://healthvault.tw/fhir/ext/pin-hash', // 消費者登入 PIN 的 scrypt 雜湊（salt:hash，永不存明碼）
};

// Observation 分類碼：步數憑證 vs 健康幣帳本（同一 Patient 下以 category 區分）
export const OBS_CATEGORY = {
  step: 'activity', // 標準 observation-category：身體活動（步數心率憑證）
  ledger: 'health-coin-ledger', // 自訂：健康幣帳本流水
};

// 交易類別
export const TXN = { earn: 'earn', spend: 'spend', adjust: 'adjust' };

// LOINC 觀測碼
export const LOINC = {
  steps: '55423-8', // Number of steps in unspecified time Pedometer
  heartRate: '8867-4', // Heart rate
};

// Account 狀態（企劃書情境四：active / on-hold，皆為 FHIR R4 合法值）
export const ACCOUNT_STATUS = { active: 'active', onHold: 'on-hold' };
