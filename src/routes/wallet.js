// /api/wallet — 錢包查詢與家屬防禦（消費者 App / 家屬端）。
//   POST /login               消費者登入：手機號碼 + PIN → walletId
//   GET  /:walletId           餘額、狀態、今日計數、近期交易
//   GET  /:walletId/ledger    完整交易帳本
//   GET  /:walletId/alerts    家屬通知（風控攔截／凍結紀錄）
//   POST /:walletId/freeze    一鍵凍結（掛失 → on-hold）
//   POST /:walletId/unfreeze  解除凍結（→ active）
import { Router } from 'express';
import { fhir } from '../fhirClient.js';
import { config, OBS_CATEGORY, ACCOUNT_STATUS } from '../config.js';
import { accountView, ledgerView, patientView, patientPinHash } from '../mappers.js';
import { findAccountByWallet, findPatientByPhone, patientRefOf, recompute, setStatus, today } from '../services/wallet.js';
import { verifyPin } from '../services/auth.js';
import { pushAlert, getAlerts } from '../services/notify.js';

const router = Router();

async function loadAccount(req, res) {
  const account = await findAccountByWallet(req.params.walletId);
  if (!account) { res.status(404).json({ error: '查無此錢包。' }); return null; }
  return account;
}

// 消費者登入：手機號碼 + PIN → 回傳 walletId（App 之後一律以 walletId 操作）。
// 安全性：無論手機是否存在、PIN 對錯，失敗一律回相同 401 訊息，避免列舉手機號碼。
// 須先於 /:walletId 等參數路由之前宣告，避免被誤判為 walletId。
router.post('/login', async (req, res, next) => {
  try {
    const { phone, pin } = req.body || {};
    if (!phone || !pin) return res.status(400).json({ error: '請輸入手機號碼與 PIN。' });
    const patient = await findPatientByPhone(phone);
    const stored = patient ? patientPinHash(patient) : null;
    if (!patient || !stored || !verifyPin(pin, stored)) {
      return res.status(401).json({ error: '手機號碼或 PIN 錯誤。' });
    }
    const v = patientView(patient);
    if (!v.walletId) return res.status(409).json({ error: '此帳號尚未綁定錢包。' });
    res.json({ ok: true, walletId: v.walletId, name: v.name });
  } catch (e) {
    next(e);
  }
});

// 錢包總覽（消費者數位卡）
router.get('/:walletId', async (req, res, next) => {
  try {
    const account = await loadAccount(req, res);
    if (!account) return;
    const v = accountView(account);
    const computed = await recompute(v.patientRef, today());
    let name = '';
    try {
      const pid = v.patientRef?.split('/').pop();
      if (pid) name = patientView(await fhir.read('Patient', pid)).name;
    } catch { /* ignore */ }

    const ledger = await fhir.searchAll('Observation', { subject: v.patientRef, category: OBS_CATEGORY.ledger, _count: 200 });
    const recent = ledger.map(ledgerView).sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 10);

    res.json({
      walletId: v.walletId,
      name,
      status: account.status,
      frozen: account.status === ACCOUNT_STATUS.onHold,
      frozenReason: v.frozenReason,
      balance: computed.balance,
      coinUnit: config.coinUnitLabel,
      today: { date: today(), earned: computed.dailyEarned, spent: computed.dailySpent, steps: computed.dailySteps },
      caps: { dailyEarn: config.dailyEarnCap, dailySpend: config.dailySpendCap },
      recent,
      barcode: v.walletId,
    });
  } catch (e) {
    next(e);
  }
});

// 完整交易帳本
router.get('/:walletId/ledger', async (req, res, next) => {
  try {
    const account = await loadAccount(req, res);
    if (!account) return;
    const patientRef = patientRefOf(account);
    const ledger = await fhir.searchAll('Observation', { subject: patientRef, category: OBS_CATEGORY.ledger, _count: 500 });
    res.json(ledger.map(ledgerView).sort((a, b) => String(b.when).localeCompare(String(a.when))));
  } catch (e) {
    next(e);
  }
});

// 家屬通知列表
router.get('/:walletId/alerts', async (req, res) => {
  res.json(getAlerts(req.params.walletId));
});

// 一鍵凍結（掛失）
router.post('/:walletId/freeze', async (req, res, next) => {
  try {
    const account = await loadAccount(req, res);
    if (!account) return;
    const reason = req.body?.reason || '家屬掛失凍結';
    const updated = await setStatus(account, ACCOUNT_STATUS.onHold, reason);
    pushAlert(req.params.walletId, { type: 'frozen', message: `帳戶已凍結：${reason}` });
    res.json({ ok: true, status: updated.status, frozen: true });
  } catch (e) {
    next(e);
  }
});

// 解除凍結
router.post('/:walletId/unfreeze', async (req, res, next) => {
  try {
    const account = await loadAccount(req, res);
    if (!account) return;
    const updated = await setStatus(account, ACCOUNT_STATUS.active);
    pushAlert(req.params.walletId, { type: 'unfrozen', message: '帳戶已解除凍結' });
    res.json({ ok: true, status: updated.status, frozen: false });
  } catch (e) {
    next(e);
  }
});

export default router;
