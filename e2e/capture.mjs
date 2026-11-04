// Screenshot tool (not a test): captures every console and bank page at 390 and 1440 px into a directory.
// Usage: node capture.mjs <out-dir>   (needs Aran on 8100 in demo mode, bank on 3100, local Supabase)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '../docs/screens/capture');
const ARAN = process.env.ARAN_BASE_URL || 'http://127.0.0.1:8100';
const BANK = process.env.BANK_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Tessera-demo-1';
fs.mkdirSync(path.join(OUT, 'console'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'bank'), { recursive: true });
const report = { shots: 0, consoleErrors: [], hscroll: [] };

const j = async (p, key, body) => { const r = await fetch(ARAN + p, { method: body ? 'POST' : 'GET', headers: { 'X-API-Key': key || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); try { return await r.json(); } catch { return null; } };
const Dt = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const Pt = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const rd = (n, f = 0) => Array.from({ length: n }, (_, i) => (i === 0 && f ? f + Math.floor(Math.random() * (10 - f)) : Math.floor(Math.random() * 10)));
const verh = (b) => { let c = 0; [...b].reverse().forEach((d, i) => { c = Dt[c][Pt[(i + 1) % 8][d]]; }); return [0,4,3,2,1,5,6,7,8,9][c]; };
const luhn = (b) => { let s = 0; [...b].reverse().forEach((d, i) => { let v = d; if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; } s += v; }); return (10 - (s % 10)) % 10; };
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L1 = () => LET[Math.floor(Math.random() * 26)];
const sample = (i) => { const a = rd(11, 2), c = [4, ...rd(14)]; return `Customer ${['Aarav Sharma','Priya Patel','Meera Nair','Rohan Gupta'][i % 4]} KYC: Aadhaar ${[...a, verh(a)].join('')}, mobile ${6 + Math.floor(Math.random() * 4)}${rd(9).join('')}, card ${[...c, luhn(c)].join('')}, PAN ${L1()}${L1()}${L1()}P${L1()}${rd(4).join('')}${L1()}`; };

async function seed() {
  const ws = await j('/v1/workspaces', '', { name: `Capture ${Date.now()}`, email: 'capture@demo.test' });
  const sinks = ['kyc-archive', 'log-platform', 'crm', 'loan-vendor'];
  for (let i = 0; i < 12; i++) await j('/v1/protect', ws.admin_key, { text: sample(i), customer_ref: `CUS-${String(i).padStart(6, '0')}`, purpose: 'KYC', sink: sinks[i % 4] });
  const p = await j('/v1/protect', ws.admin_key, { text: sample(99), customer_ref: 'CUS-REVEAL', purpose: 'KYC', sink: 'kyc-archive' });
  const tok = p.findings.find((f) => f.type === 'AADHAAR' && f.protected).token;
  await j('/v1/detokenise', ws.admin_key, { token: tok });
  await j('/v1/erase', ws.admin_key, { customer_ref: 'CUS-000001', purpose: 'KYC' });
  const empty = await j('/v1/workspaces', '', { name: `Empty ${Date.now()}`, email: 'e@demo.test' });
  return { admin: ws.admin_key, empty: empty.admin_key };
}

async function open(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/401|403|429/.test(m.text())) report.consoleErrors.push(`${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${page.url()}: ${e.message}`));
  return { ctx, page };
}
async function shot(page, dir, name) {
  await page.waitForTimeout(250);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) report.hscroll.push(`${dir}/${name}: ${o.sw} > ${o.iw}`);
  await page.screenshot({ path: path.join(OUT, dir, `${name}.png`), fullPage: true }); report.shots++;
}
const go = async (page, url) => { await page.goto(url); await page.waitForLoadState('networkidle'); };
const settled = (page) => page.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 15000 }).catch(() => {});

const keys = await seed();
await j('/v1/internal/reset-limiters', keys.admin, {});
const browser = await chromium.launch();
for (const [tag, vp] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
  // ---------------- console
  let { ctx, page } = await open(browser, vp);
  await go(page, ARAN + '/'); await page.waitForSelector('#demo-meta .pill', { timeout: 15000 }).catch(() => {}); await shot(page, 'console', `landing-${tag}`);
  await go(page, ARAN + '/signup'); await shot(page, 'console', `signup-${tag}`);
  await page.click('#go'); await shot(page, 'console', `signup-error-${tag}`);
  await go(page, ARAN + '/connect'); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await shot(page, 'console', `connect-needkey-${tag}`);
  await page.evaluate((k) => sessionStorage.setItem('aran_key', k), keys.admin); await page.reload(); await page.waitForSelector('#flow:not([hidden])'); await page.click('#test'); await page.waitForSelector('#status.ok', { timeout: 15000 }).catch(() => {}); await shot(page, 'console', `connect-${tag}`);
  await go(page, ARAN + '/dashboard'); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await shot(page, 'console', `dashboard-signin-${tag}`);
  await page.evaluate((k) => sessionStorage.setItem('aran_key', k), keys.admin);
  for (const tab of ['overview', 'flows', 'keys', 'trace', 'receipts', 'audit', 'playground']) {
    await go(page, ARAN + '/dashboard#' + tab); await page.reload(); await page.waitForSelector('#app:not([hidden])'); await settled(page);
    if (tab === 'flows') { await page.click('#view tbody tr').catch(() => {}); await page.waitForSelector('.drawer h3', { timeout: 5000 }).catch(() => {}); }
    await shot(page, 'console', `dashboard-${tab}-${tag}`);
  }
  await page.evaluate((k) => sessionStorage.setItem('aran_key', k), keys.empty);
  for (const tab of ['overview', 'flows', 'receipts', 'audit']) { await go(page, ARAN + '/dashboard#' + tab); await page.reload(); await page.waitForSelector('#app:not([hidden])'); await settled(page); await shot(page, 'console', `dashboard-empty-${tab}-${tag}`); }
  await ctx.close();

  // ---------------- bank, every role
  const roles = [['kyc', ['/dashboard', '/customers', '/customers/new', '/accounts']], ['support', ['/dashboard', '/customers', '/support']],
    ['compliance', ['/dashboard', '/customers', '/accounts', '/compliance']], ['admin', ['/dashboard', '/customers', '/accounts', '/support', '/vendor', '/compliance', '/data-plane']]];
  ({ ctx, page } = await open(browser, vp));
  await go(page, BANK + '/login'); await shot(page, 'bank', `login-${tag}`);
  await go(page, BANK + '/portal'); await shot(page, 'bank', `portal-${tag}`);
  await ctx.close();
  for (const [role, pages] of roles) {
    ({ ctx, page } = await open(browser, vp));
    await go(page, BANK + '/login'); await page.fill('#email', `${role}@tessera.test`); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL('**/dashboard'); await page.waitForLoadState('networkidle');
    for (const p of pages) {
      await go(page, BANK + p); await shot(page, 'bank', `${role}${p.replace(/\//g, '-')}-${tag}`);
      if (p === '/customers') {
        const href = await page.locator('tbody a').first().getAttribute('href'); if (href) { await go(page, BANK + href); await shot(page, 'bank', `${role}-customer-detail-${tag}`); }
      }
      if (p === '/accounts') {
        const href = await page.locator('tbody a[href^="/accounts/"]').first().getAttribute('href').catch(() => null); if (href) { await go(page, BANK + href); await shot(page, 'bank', `${role}-account-${tag}`); }
      }
    }
    if (role === 'kyc') { await go(page, BANK + '/compliance'); await shot(page, 'bank', `kyc-denied-${tag}`); }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'capture-report.json'), JSON.stringify(report, null, 2));
console.log(`captured ${report.shots} screenshots into ${OUT}; console errors: ${report.consoleErrors.length}; horizontal scroll: ${report.hscroll.length}`);
if (report.consoleErrors.length) console.log([...new Set(report.consoleErrors)].slice(0, 10).join('\n'));
if (report.hscroll.length) console.log(report.hscroll.join('\n'));
