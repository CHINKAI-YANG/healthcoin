// 灌入企劃書四大情境的範例資料：在本機啟動 app（連到設定的 FHIR 伺服器），
// 透過自身 API 註冊使用者並完成走路發幣、批次同步與一筆核銷，方便展示。
// 執行：npm run seed
import { createApp } from '../server.js';
import { config } from '../src/config.js';

if (!config.fhirBaseUrl) {
  console.error('\n[設定錯誤] 未設定 FHIR_BASE_URL —— 灌入範例資料需要可寫入的 FHIR 伺服器位址（必填，無預設值）。');
  console.error('請於專案根目錄建立 .env（可複製 .env.example）並填入，或以環境變數帶入，例如：');
  console.error('  FHIR_BASE_URL=https://tzuchi-fhir.ddns.net/fhir   # 慈濟 FHIR 測試站');
  console.error('  FHIR_BASE_URL=https://hapi.fhir.org/baseR4        # 公開 HAPI 測試站\n');
  process.exit(1);
}

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const ADMIN = config.adminPassword;
const TODAY = new Date().toISOString().slice(0, 10);
const dMinus = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function api(method, p, body) {
  const headers = { 'x-admin-key': ADMIN };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

try {
  console.log(`\n灌入範例資料到 FHIR：${config.fhirBaseUrl}\n（租戶：${config.tenantTag}）\n`);
  const health = await api('GET', '/api/health');
  if (!health.ok) console.warn('⚠ FHIR 健檢未通過，仍嘗試寫入：', health.error || '');

  // 情境一：上班族小明（即時 + 有氧）。有手機 → 以手機號碼 + PIN 登入 App。
  const ming = await api('POST', '/api/users', { name: '小明', phone: '0911111111', pin: '1234' });
  const s1 = await api('POST', '/api/engine/sync', { walletId: ming.walletId, steps: 8500, heartRate: 130, date: TODAY });
  console.log(`情境一 小明      手機 ${ming.phone} PIN ${ming.pin}  發幣 ${s1.minted}（有氧加權）餘額 ${s1.balance}  walletId=${ming.walletId}`);

  // 情境二：林阿公（手機背景上傳）。有手機 → 以手機號碼 + PIN 登入 App。
  const gong = await api('POST', '/api/users', { name: '林阿公', phone: '0922222222', pin: '5678' });
  const s2 = await api('POST', '/api/engine/sync', { walletId: gong.walletId, steps: 5000, date: TODAY });
  console.log(`情境二 林阿公    手機 ${gong.phone} PIN ${gong.pin}  發幣 ${s2.minted} 餘額 ${s2.balance}  walletId=${gong.walletId}`);

  // 情境二：王阿嬤（無手機，手環 + Kiosk 批次同步），並預先跨日累積供核銷展示
  const ama = await api('POST', '/api/users', { name: '王阿嬤', wristbandUid: 'WB-AMA-001' });
  for (let i = 1; i <= 2; i++) await api('POST', '/api/engine/sync', { walletId: ama.walletId, steps: 80000, date: dMinus(i), syncWindowHours: 24 });
  const batch = await api('POST', '/api/engine/batch-sync', { nodeId: 'KIOSK-活動中心', items: [{ wristbandUid: 'WB-AMA-001', steps: 35000, syncWindowHours: 168 }] });
  const amaWallet = await api('GET', `/api/wallet/${ama.walletId}`);
  console.log(`情境二 王阿嬤    walletId=${ama.walletId}  手環批次發幣 ${batch.results[0].minted}，總餘額 ${amaWallet.balance}`);

  // 情境三：王阿嬤到特約藥局核銷血壓計
  const rx = await api('POST', '/api/pos/redeem', { walletId: ama.walletId, itemCode: 'BPCUFF', posId: 'POS-藥局A' });
  console.log(`情境三 核銷      王阿嬤 核銷血壓計 -${rx.cost}，餘額 ${rx.balance}`);

  console.log('\n完成！開啟 http://localhost:' + config.port + '/ ，於消費者 App 以上述手機號碼 + PIN 登入（或進階改用 walletId）即可操作。');
  console.log('（提醒：請於能連外網的電腦執行，且 FHIR_BASE_URL 指向可寫入的伺服器。）\n');
} catch (e) {
  console.error('\n灌入失敗：', e.message);
  console.error('若為連線/權限問題，請確認 FHIR_BASE_URL 可連線且允許寫入。\n');
  process.exitCode = 1;
} finally {
  srv.close();
}
