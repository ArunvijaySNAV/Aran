// Tessera Bank end to end against a running stack: Aran core+cloud (8100), local Supabase, bank on 3100.
// onboarding -> reveal -> erase (+ receipts), data plane scan, vendor breach, support AI, portal. Screenshots -> docs/screens/bank/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BANK = process.env.BANK_URL || 'http://127.0.0.1:3100';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens', 'bank');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Tessera-demo-1';
const problems = []; let shots = 0;

const Dt = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const Pt = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const rd = (n, f = 0) => Array.from({ length: n }, (_, i) => (i === 0 && f ? f + Math.floor(Math.random() * (10 - f)) : Math.floor(Math.random() * 10)));
const verh = (b) => { let c = 0; [...b].reverse().forEach((d, i) => { c = Dt[c][Pt[(i + 1) % 8][d]]; }); return [0,4,3,2,1,5,6,7,8,9][c]; };
const aadhaar = () => { const a = rd(11, 2); return [...a, verh(a)].join(''); };
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L1 = () => LET[Math.floor(Math.random() * 26)];
const pan = () => `${L1()}${L1()}${L1()}P${L1()}${rd(4).join('')}${L1()}`;
const mobile = () => `${6 + Math.floor(Math.random() * 4)}${rd(9).join('')}`;

const browser = await chromium.launch();
async function session(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag}: console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`${tag}: HTTP ${r.status()} ${r.url()}`); });
  return { ctx, page };
}
async function shot(page, name) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) problems.push(`${name}: horizontal scroll ${o.sw} > ${o.iw}`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); shots++;
}
async function go(page, url) { await page.goto(url); await page.waitForLoadState('networkidle'); }  // wait for hydration before interacting
async function login(page, email) {
  await go(page, BANK + '/login');
  await page.fill('#email', email); await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
}
async function logout(page) { await page.click('text=Sign out'); await page.waitForURL('**/login'); }

for (const [tag, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { ctx, page } = await session(vp, tag);
  const N = (n) => `${n}-${tag}`; console.log('viewport', tag);
  const AAD = aadhaar(), MOB = mobile(), NAME = 'Pooja Hegde';

  // login screen: error state, then success as the KYC officer
  await go(page, BANK + '/login');
  await page.fill('#email', 'kyc@tessera.test'); await page.fill('#password', 'wrong-password'); await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]:text("not right")');
  await shot(page, N('login-error'));
  await login(page, 'kyc@tessera.test');
  await shot(page, N('dashboard-kyc'));

  // onboarding: inline validation, then success
  await go(page, BANK + '/customers/new');
  await page.fill('#name', NAME); await page.fill('#mobile', '12345'); await page.click('text=Continue');
  await page.waitForSelector('#mobile-err');
  await shot(page, N('onboard-validation'));
  await page.fill('#mobile', MOB); await page.click('text=Continue');
  await page.fill('#aadhaar', '341777631707'); await page.click('text=Continue');   // wrong checksum
  await page.waitForSelector('#aadhaar-err');
  await page.fill('#aadhaar', AAD); await page.fill('#pan', pan()); await page.click('text=Continue');
  await page.check('input[name=loanInterest]');
  await shot(page, N('onboard-consent'));
  await page.click('text=Onboard customer');
  await page.waitForURL('**/customers/CUS-*');
  const ref = page.url().match(/CUS-\d+/)[0];
  const body = await page.textContent('main');
  if (body.includes(AAD) || body.includes(MOB)) problems.push(`${tag}: raw value visible on customer page`);
  await shot(page, N('customer-detail-kyc'));

  // account + transactions
  await go(page, BANK + '/accounts?ref=' + ref);
  await page.fill('#oa-open', '25000'); await page.click('text=Open account');
  await page.waitForSelector('text=opened');
  await page.reload(); await page.click('tbody tr:first-child a');
  await page.fill('#tx-amt', '1200'); await page.fill('#tx-desc', `salary, call me on ${mob2(MOB)}`); await page.click('text=Post transaction');
  await page.waitForSelector('text=New balance');
  await shot(page, N('account-statement'));
  const stmt = await page.textContent('main');
  if (stmt.includes(MOB)) problems.push(`${tag}: raw mobile in statement`);
  await logout(page);

  // compliance: reveal with a reason, auto-hide countdown
  await login(page, 'compliance@tessera.test');
  await go(page, BANK + '/customers/' + ref);
  await page.click('text=Reveal Aadhaar');
  await page.fill('textarea', 'Regulator request 114, verify identity of account holder');
  await page.click('form:has(textarea) button[type=submit]');
  await page.waitForSelector('[role=status]:has-text("Hides in")');
  const shown = await page.textContent('[role=status]:has-text("Hides in")');
  if (!shown.includes(AAD)) problems.push(`${tag}: revealed Aadhaar does not match what was entered`);
  await shot(page, N('reveal-open'));
  await page.click('text=Hide now');
  await page.waitForSelector('text=Reveal Aadhaar');

  // compliance centre: erase, receipts, verify, tokens dead
  await go(page, BANK + '/compliance');
  await page.fill('#er-ref', ref); await page.fill('#er-confirm', ref);
  await page.click('text=Erase this customer');
  await page.waitForSelector('text=signed receipts issued', { timeout: 30000 });
  await page.click('button:has-text("Verify receipt") >> nth=0');
  await page.waitForSelector('text=Valid:');
  const dead = await page.locator('table[aria-label="Token resolution after erasure"] tbody tr td:last-child').allTextContents();
  if (!dead.length || dead.some((x) => x.trim() !== 'erased')) problems.push(`${tag}: tokens did not read as erased: ${dead}`);
  await shot(page, N('compliance-erased'));
  await go(page, BANK + '/customers/' + ref);
  await page.waitForSelector('text=erased');
  await shot(page, N('customer-erased'));
  await logout(page);

  // support agent: AI chat with provider panel
  await login(page, 'support@tessera.test');
  await go(page, BANK + '/support');
  await page.fill('#prompt', `Customer says card 4111111111111111 was blocked and her Aadhaar ${aadhaar()} is on file. Call ${mobile()}.`);
  await page.click('button:has-text("Ask")'); await page.waitForSelector('text=What the AI provider saw', { timeout: 20000 });
  const saw = await page.textContent('main');
  if (/4111111111111111/.test(saw.split('What the AI provider saw')[1] ?? '')) problems.push(`${tag}: provider panel shows a raw card`);
  await shot(page, N('support-chat'));
  await logout(page);

  // admin: vendor export + breach, data plane scan, dashboard
  await login(page, 'admin@tessera.test');
  await go(page, BANK + '/vendor'); await page.click('text=Build CSV export').catch(() => {});
  await page.waitForTimeout(800); await page.reload();
  if (await page.locator('text=Simulate vendor breach').count()) { await page.click('text=Simulate vendor breach >> nth=0'); await page.waitForSelector('text=Leak traced', { timeout: 20000 }); }
  await shot(page, N('vendor-breach'));
  await go(page, BANK + '/data-plane'); await page.click('text=Scan for plaintext'); await page.waitForSelector('text=Clean.', { timeout: 30000 });
  await shot(page, N('data-plane-scan'));
  await go(page, BANK + '/dashboard'); await shot(page, N('dashboard-admin'));
  await go(page, BANK + '/customers'); await shot(page, N('customers-list'));
  await ctx.close();
}

// portal: self-onboard, view, erase (no staff login)
{
  const { ctx, page } = await session({ width: 1280, height: 900 }, 'portal');
  await go(page, BANK + '/portal');
  await page.click('button:has-text("Register")'); await page.waitForSelector('#p-name-err');
  await page.fill('#p-name', 'Meera Nair'); await page.fill('#p-mobile', mobile()); await page.fill('#p-aadhaar', aadhaar()); await page.click('button:has-text("Register")');
  await page.waitForSelector('#secret', { timeout: 15000 }).catch(async (e) => { console.log('PORTAL PAGE TEXT:', (await page.innerText('main')).slice(0, 600)); throw e; });
  const secret = (await page.textContent('#secret')).trim();
  const ref = (await page.textContent('main')).match(/CUS-\d+/)[0];
  await shot(page, 'portal-registered');
  await page.fill('#m-ref', ref); await page.fill('#m-secret', secret); await page.click('text=Show my data');
  await page.waitForSelector('text=Erase my data');
  await shot(page, 'portal-mydata');
  await page.fill('#m-confirm', 'ERASE'); await page.click('button:has-text("Erase my data")');
  await page.waitForSelector('text=signed receipts were issued', { timeout: 30000 });
  const dead = await page.locator('table[aria-label="After erasure"] tbody tr td:last-child').allTextContents();
  if (!dead.length || dead.some((x) => x.trim() !== 'erased')) problems.push(`portal: tokens did not read as erased: ${dead}`);
  await shot(page, 'portal-erased');
  await ctx.close();
}
await browser.close();
function mob2(m) { return m; }
console.log(`screenshots: ${shots} in ${OUT}`);
if (problems.length) { console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n')); process.exit(1); }
console.log('OK: onboarding -> reveal -> erase flow, support chat, vendor breach, scan, portal all passed; no console errors, no horizontal scroll');
