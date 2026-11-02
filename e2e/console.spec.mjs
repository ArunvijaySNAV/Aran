// Visits every console page at 390 px and 1440 px, saves screenshots to docs/screens/, and asserts:
// no console errors, no page errors, no failed requests, no horizontal scroll, and that each data view renders.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.ARAN_BASE_URL || 'http://127.0.0.1:8100';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
let expect401 = false; // set while deliberately submitting a wrong key
let shots = 0;
const j = async (p, key, body, method) => {
  const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-API-Key': key || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, data: d };
};

// ---- generated, checksum-valid sample records (belong to nobody)
const Dt = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const Pt = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const rd = (n, f = 0) => Array.from({ length: n }, (_, i) => (i === 0 && f ? f + Math.floor(Math.random() * (10 - f)) : Math.floor(Math.random() * 10)));
const verh = (b) => { let c = 0; [...b].reverse().forEach((d, i) => { c = Dt[c][Pt[(i + 1) % 8][d]]; }); return [0,4,3,2,1,5,6,7,8,9][c]; };
const luhn = (b) => { let s = 0; [...b].reverse().forEach((d, i) => { let v = d; if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; } s += v; }); return (10 - (s % 10)) % 10; };
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L1 = () => LET[Math.floor(Math.random() * 26)];
const NAMES = ['Aarav Sharma', 'Priya Patel', 'Meera Nair', 'Rohan Gupta', 'Sunita Rao', 'Karthik Menon', 'Divya Iyer'];
const sample = (i) => { const a = rd(11, 2), c = [4, ...rd(14)]; return `Customer ${NAMES[i % NAMES.length]} KYC: Aadhaar ${[...a, verh(a)].join('')}, mobile ${6 + Math.floor(Math.random() * 4)}${rd(9).join('')}, card ${[...c, luhn(c)].join('')}, PAN ${L1()}${L1()}${L1()}P${L1()}${rd(4).join('')}${L1()}`; };

// ---- seed a workspace through the real API (generated sample records only)
async function seed() {
  const ws = (await j('/v1/workspaces', '', { name: `Screens Demo ${Date.now()}`, email: 'screens@demo.test' })).data;
  const admin = ws.admin_key;
  const sinks = ['kyc-archive', 'log-platform', 'crm', 'loan-vendor'];
  for (let i = 0; i < 14; i++) {
    await j('/v1/protect', admin, { text: sample(i), customer_ref: `CUS-${String(i).padStart(6, '0')}`, purpose: 'KYC', sink: sinks[i % sinks.length] });
  }
  const p = (await j('/v1/protect', admin, { text: sample(99), customer_ref: 'CUS-REVEAL', purpose: 'KYC', sink: 'kyc-archive' })).data;
  const tok = p.findings.find((f) => f.type === 'AADHAAR' && f.protected).token;
  await j('/v1/detokenise', admin, { token: tok });
  await j('/v1/detokenise', admin, { token: '123456789012' });
  await j('/v1/erase', admin, { customer_ref: 'CUS-000001', purpose: 'KYC' });
  return { admin, dash: ws.dashboard_key };
}

function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !(expect401 && /401/.test(m.text()))) problems.push(`${label}: console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`${label}: request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon') && !(expect401 && r.status() === 401)) problems.push(`${label}: HTTP ${r.status()} ${r.url()}`); });
}
async function noHScroll(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) problems.push(`${label}: horizontal scroll (${o.sw} > ${o.iw})`);
}
async function shot(page, name, label) {
  await noHScroll(page, label);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  shots++;
}

const keys = await seed();
const resetLimiters = () => j('/v1/internal/reset-limiters', keys.admin, {}); // works in demo mode only
await resetLimiters();
const browser = await chromium.launch();
const sizes = [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]];

for (const [tag, viewport] of sizes) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    const L = (n) => `${n}@${tag}/${scheme}`;
    await resetLimiters();
    watch(page, `${tag}/${scheme}`);
    const suffix = `${tag}-${scheme}`;
    const full = scheme === 'light'; // all pages in light; key pages again in dark

    // landing: wait for the real demo call to land
    await page.goto(BASE + '/');
    await page.waitForSelector('#demo-meta .pill', { timeout: 15000 });
    await page.waitForTimeout(900);
    const beforeTxt = await page.textContent('#demo-before'), afterTxt = await page.textContent('#demo-after');
    if (!/Aadhaar \d{12}/.test(beforeTxt) || /Aadhaar \d{12}/.test(afterTxt) && beforeTxt === afterTxt) problems.push(L('landing') + ': demo before/after look wrong');
    await shot(page, `landing-${suffix}`, L('landing'));

    if (full) {
      // signup: validation error state, then success
      await page.goto(BASE + '/signup');
      await page.click('#go');
      if (!(await page.textContent('#name-err')).trim()) problems.push(L('signup') + ': no validation message');
      await shot(page, `signup-error-${suffix}`, L('signup-error'));
      await page.fill('#name', 'Screens Co'); await page.fill('#email', 'a@screens.test');
      await page.click('#go');
      await page.waitForSelector('#keys-view:not([hidden])', { timeout: 10000 });
      await shot(page, `signup-keys-${suffix}`, L('signup-keys'));

      // connect: needs a key (empty state first), then flow with test event
      await page.goto(BASE + '/connect');
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await shot(page, `connect-needkey-${suffix}`, L('connect-needkey'));
      await page.evaluate((k) => sessionStorage.setItem('aran_key', k), keys.admin);
      await page.reload();
      await page.waitForSelector('#flow:not([hidden])');
      await page.click('#test');
      await page.waitForSelector('#status.ok', { timeout: 15000 });
      await shot(page, `connect-${suffix}`, L('connect'));
    }

    // dashboard sign-in (no key) then every tab with a key
    await page.goto(BASE + '/dashboard');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.waitForSelector('#signin:not([hidden])');
    if (full) {
      expect401 = true;
      await page.fill('#key', 'aran_live_wrong'); await page.press('#key', 'Enter');
      await page.waitForFunction(() => document.querySelector('#key-err').textContent.length > 0);
      expect401 = false;
    }
    await shot(page, `dashboard-signin-${suffix}`, L('signin'));

    await page.evaluate((k) => sessionStorage.setItem('aran_key', k), keys.admin);
    for (const tab of ['overview', 'flows', 'keys', 'trace', 'receipts', 'audit', 'playground']) {
      if (!full && !['overview', 'receipts'].includes(tab)) continue;
      await page.goto(BASE + '/dashboard#' + tab);
      await page.reload();
      await page.waitForSelector('#app:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 15000 });
      if (tab === 'overview') await page.waitForSelector('.bars');
      if (tab === 'flows') { await page.click('#view tbody tr'); await page.waitForSelector('.drawer h3'); }
      if (tab === 'keys') { await page.fill('#key-label', 'Screens app key'); await page.click('#view button[type=submit]'); await page.waitForSelector('#newkey'); await shot(page, `dashboard-keys-created-${suffix}`, L('keys-created')); await page.click('#dlg-body .btn.primary'); }
      if (tab === 'trace') { await page.click('text=Use my latest tokens as a sample'); await page.waitForFunction(() => document.querySelector('#dump').value.length > 0); await page.click('text=Trace this dump'); await page.waitForSelector('.banner.ok'); }
      if (tab === 'receipts') { await page.click('text=Verify >> nth=0'); await page.waitForSelector('.pill.ok:text("Valid")'); }
      if (tab === 'audit') { await page.click('text=Verify chain'); await page.waitForSelector('.banner.ok'); }
      if (tab === 'playground') { await page.click('text=Insert a generated sample'); await page.waitForFunction(() => document.querySelector('#pg').value.length > 0); await page.click('text=Protect this text'); await page.waitForSelector('.tok'); }
      await page.waitForTimeout(150);
      await shot(page, `dashboard-${tab}-${suffix}`, L(tab));
    }

    if (full && tag === '1440') {
      // keyboard: the skip link and first nav item are reachable by Tab
      await page.goto(BASE + '/dashboard#overview'); await page.reload(); await page.waitForSelector('#app:not([hidden])');
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement && (document.activeElement.className + ' ' + document.activeElement.tagName));
      if (!focused || /BODY/.test(focused)) problems.push('keyboard: focus did not move');
    }
    await ctx.close();
  }
}
// empty states: a brand-new workspace has no data
{
  const ws = (await j('/v1/workspaces', '', { name: `Empty ${Date.now()}`, email: 'e@e.test' })).data;
  for (const [tag, viewport] of sizes) {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); watch(page, `empty/${tag}`);
    await page.goto(BASE + '/dashboard'); await page.evaluate((k) => sessionStorage.setItem('aran_key', k), ws.admin_key);
    for (const tab of ['overview', 'flows', 'audit', 'receipts']) {
      await page.goto(BASE + '/dashboard#' + tab); await page.reload(); await page.waitForSelector('#app:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 15000 });
      if (!(await page.locator('#view .state').count())) problems.push(`empty/${tag}: ${tab} has no empty state`);
      if (tab === 'overview') await shot(page, `dashboard-empty-${tag}`, `empty-${tab}@${tag}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`screenshots saved: ${shots} in ${OUT}`);
if (problems.length) { console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n')); process.exit(1); }
console.log('OK: no console errors, no failed requests, no horizontal scroll, all views rendered');
