// /api/users — 發卡與使用者管理（管理端，需密碼授權）。
// 註冊一位使用者＝建立 Patient（真實身分主體）＋ Account（健康幣錢包，含虛擬 walletId）。
// 關聯阻斷：walletId 為對外識別，商戶端只見 walletId，不見真實姓名。
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { fhir } from '../fhirClient.js';
import { SYSTEMS } from '../config.js';
import { buildPatient, buildAccount, patientView, accountView } from '../mappers.js';
import { recompute } from '../services/wallet.js';
import { normalizePhone, isValidPin, generatePin, hashPin } from '../services/auth.js';

const router = Router();

// 註冊使用者並發給錢包
router.post('/', async (req, res, next) => {
  try {
    const { name, wristbandUid } = req.body || {};
    if (!name) return res.status(400).json({ error: '需提供使用者姓名 name。' });

    // 手環 UID 去重（同一手環不重複建檔）
    if (wristbandUid) {
      const dup = await fhir.search('Patient', { identifier: `${SYSTEMS.wristband}|${wristbandUid}` });
      if (dup.length) return res.status(409).json({ error: `手環 UID ${wristbandUid} 已綁定其他使用者。` });
    }

    // 手機號碼（選填）＝消費者 App 的登入帳號，需唯一；可附 PIN，未帶則系統自動產生 6 位數。
    // PIN 僅在此回應回傳一次（明碼），請轉交使用者後妥善保管；資料庫只存雜湊。
    let phone = null;
    let issuedPin = null;
    let pinHash = null;
    if (req.body?.phone) {
      phone = normalizePhone(req.body.phone);
      if (!/^\+?\d{6,15}$/.test(phone)) return res.status(400).json({ error: '手機號碼格式不正確。' });
      const dupPhone = await fhir.search('Patient', { identifier: `${SYSTEMS.phone}|${phone}` });
      if (dupPhone.length) return res.status(409).json({ error: `手機號碼 ${phone} 已綁定其他使用者。` });
      if (req.body.pin != null && req.body.pin !== '') {
        if (!isValidPin(req.body.pin)) return res.status(400).json({ error: 'PIN 需為 4–6 位數字。' });
        issuedPin = String(req.body.pin);
      } else {
        issuedPin = generatePin();
      }
      pinHash = hashPin(issuedPin);
    }

    const walletId = randomUUID();
    const patient = await fhir.create('Patient', buildPatient({ name, walletId, wristbandUid, phone, pinHash }));
    const account = await fhir.create('Account', buildAccount({ patientRef: `Patient/${patient.id}`, walletId, name }));

    res.status(201).json({
      ...patientView(patient),
      accountId: account.id,
      status: account.status,
      balance: 0,
      barcode: walletId, // 數位卡 / 實體卡 / 靜態條碼之載具內容
      ...(issuedPin ? { pin: issuedPin } : {}), // 一次性回傳 PIN（明碼僅此一次）
    });
  } catch (e) {
    next(e);
  }
});

// 管理總覽：列出所有錢包（含即時重算餘額）。供發卡端 / 營運稽核使用。
router.get('/', async (req, res, next) => {
  try {
    const accounts = await fhir.searchAll('Account', { _count: 300 });
    const out = [];
    for (const acc of accounts) {
      const v = accountView(acc);
      const computed = await recompute(v.patientRef, undefined);
      let name = '';
      try {
        const pid = v.patientRef?.split('/').pop();
        if (pid) name = patientView(await fhir.read('Patient', pid)).name;
      } catch { /* ignore */ }
      out.push({ ...v, name, balance: computed.balance });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'));
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
