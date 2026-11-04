// Admin "Aran connection" page end to end, against a running stack: Aran core+cloud (8100), local Supabase, the bank on 3100 with CONNECTION_ENC_KEY set.
// Needs the bank's env in the shell (it types the real keys into the page, then checks they never come back):  set -a; source bank/.env.local; set +a
// Flow: admin saves, tests, rejects a bad key, reports an unreachable address, disconnects; non-admin roles are denied. Screenshots -> docs/screens/after/bank/aran-connection-*.
// Optional READONLY_URL (a bank started with CONNECTION_ENC_KEY empty) checks the read-only state.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BANK = process.env.BANK_URL || 'http://127.0.0.1:3100';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens', 'after', 'bank');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Tessera-demo-1';
const ARAN = process.env.ARAN_BASE_URL, APP = process.env.ARAN_APP_KEY, COMP = process.env.ARAN_COMPLIANCE_KEY;
if (!ARAN || !APP || !COMP) { console.error('ARAN_BASE_URL, ARAN_APP_KEY and ARAN_COMPLIANCE_KEY must be in the environment'); process.exit(2); }
const SECRETS = [APP, COMP];
const problems = []; let shots = 0;
const check = (cond, msg) => { if (!cond) problems.push(msg); };

const browser = await chromium.launch();
async function open(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const bodies = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag}: console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
  page.on('response', async (r) => {
    if (r.status() >= 500) problems.push(`${tag}: HTTP ${r.status()} ${r.url()}`);
    if (r.url().startsWith(BANK)) { try { bodies.push(await r.text()); } catch { /* streamed or binary */ } }
  });
  return { ctx, page, bodies };
}
const login = async (page, email) => { await page.goto(BANK + '/login'); await page.fill('#email', email); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL('**/dashboard'); };
const shot = async (page, name, tag) => {
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(o[0] <= o[1] + 1, `${tag} ${name}: horizontal scroll ${o[0]} > ${o[1]}`);
  await page.screenshot({ path: path.join(OUT, `aran-connection-${name}-${tag}.png`), fullPage: true }); shots++;
};
const status = (page) => page.locator('[data-aran-status]').first().getAttribute('data-aran-status');
const fill = async (page, url, app, comp) => { await page.fill('#aran-url', url); await page.fill('#aran-app-key', app); await page.fill('#aran-compliance-key', comp); };
const waitStatus = (page, st) => page.waitForFunction((x) => document.querySelector('[data-aran-status]')?.getAttribute('data-aran-status') === x, st, { timeout: 30000 });
const settled = (page, text) => page.waitForSelector(`main >> text=${text}`, { timeout: 30000 });
const noKeys = async (page, bodies, where) => {
  const html = await page.content();
  for (const s of SECRETS) { check(!html.includes(s), `${where}: a full key is in the page HTML`); check(!bodies.some((b) => b.includes(s)), `${where}: a full key is in a response body`); }
  check(!/aran_live_[0-9a-f]{12,}/.test(html), `${where}: something shaped like a key is in the page HTML`);
};

for (const [tag, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  // ---- administrator
  const { ctx, page, bodies } = await open(vp, tag);
  await login(page, 'admin@tessera.test');
  check(await page.locator('nav[aria-label=Main] a:has-text("Aran connection")').count() === 1, `${tag}: admin nav has no "Aran connection" link`);
  await page.goto(BANK + '/settings/aran'); await page.waitForLoadState('networkidle');
  check((await page.locator('h1').first().textContent()).trim() === 'Aran connection', `${tag}: heading`);
  check(await status(page) === 'not_connected', `${tag}: starts as Not connected (status was ${await status(page)})`);
  await shot(page, 'not-connected', tag);

  await fill(page, ARAN, APP, COMP); await page.click('button:has-text("Save")');
  await settled(page, 'Aran Cloud is connected');
  check(await status(page) === 'connected', `${tag}: after Save the status is Connected`);
  const facts = await page.locator('dl').first().innerText();
  check(facts.includes(APP.slice(-4)) && facts.includes(COMP.slice(-4)), `${tag}: last four characters of both keys are shown`);
  check(facts.includes('Tessera Bank'), `${tag}: workspace name from Aran is shown`);
  check(facts.includes('admin@tessera.test'), `${tag}: who changed it is shown`);
  for (const id of ['#aran-app-key', '#aran-compliance-key']) check((await page.inputValue(id)) === '', `${tag}: ${id} is cleared after Save`);
  check(await page.locator('main li:has-text("Problem")').count() === 0, `${tag}: no failed check after a good save`);
  await noKeys(page, bodies, `${tag} after save`);
  await shot(page, 'connected', tag);

  await page.click('button:has-text("Test connection")'); await settled(page, 'All checks passed');
  const items = await page.locator('main section[aria-label] li').count();
  check(items >= 9, `${tag}: expected at least 9 separate checks, saw ${items}`);
  await noKeys(page, bodies, `${tag} after test`);

  // a rejected key
  await page.fill('#aran-app-key', 'aran_live_00000000000000000000000000000000'); await page.click('button:has-text("Save")');
  await waitStatus(page, 'key_rejected');
  check(await status(page) === 'key_rejected', `${tag}: a wrong key gives Key rejected (was ${await status(page)})`);
  check((await page.locator('main').innerText()).includes('Aran says this key is invalid'), `${tag}: the rejection is explained in plain language`);
  await noKeys(page, bodies, `${tag} after a bad key`);
  await shot(page, 'key-rejected', tag);

  // an unreachable address
  await fill(page, 'http://127.0.0.1:9', APP, COMP); await page.click('button:has-text("Save")');
  await waitStatus(page, 'unreachable');
  check(await status(page) === 'unreachable', `${tag}: a dead address gives Unreachable (was ${await status(page)})`);
  await shot(page, 'unreachable', tag);

  // put the good connection back, then disconnect
  await fill(page, ARAN, APP, COMP); await page.click('button:has-text("Save")'); await waitStatus(page, 'connected');
  await page.click('button:has-text("Disconnect")'); await page.click('button:has-text("Confirm disconnect")'); await waitStatus(page, 'not_connected');
  check(await status(page) === 'not_connected', `${tag}: after Disconnect the status is Not connected`);
  check((await page.locator('dl').first().innerText()).includes('Environment variables'), `${tag}: the bank is back on its environment variables`);
  await shot(page, 'disconnected', tag);
  // the bank still works on the environment variables after a disconnect: the customers page reads the database, the data plane scan needs no Aran; use the dashboard
  await page.goto(BANK + '/dashboard'); check(await page.locator('h1').count() === 1, `${tag}: dashboard loads after disconnect`);
  await ctx.close();

  // ---- every other role is denied
  for (const [email, label] of [['kyc@tessera.test', 'KYC officer'], ['support@tessera.test', 'support agent'], ['compliance@tessera.test', 'compliance officer']]) {
    const c = await open(vp, tag);
    await login(c.page, email);
    check(await c.page.locator('nav[aria-label=Main] a:has-text("Aran connection")').count() === 0, `${tag}: ${label} sees the nav link`);
    await c.page.goto(BANK + '/settings/aran'); await c.page.waitForLoadState('networkidle');
    check(c.page.url().includes('/dashboard?denied=1'), `${tag}: ${label} was not redirected to the denied page (url ${c.page.url()})`);
    check(await c.page.locator('text=Your role cannot open that page').count() === 1, `${tag}: ${label} did not see the denied message`);
    if (email.startsWith('kyc')) await shot(c.page, 'denied', tag);
    await c.ctx.close();
  }
}

// ---- read-only state (a bank started without CONNECTION_ENC_KEY)
if (process.env.READONLY_URL) {
  for (const [tag, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const { ctx, page } = await open(vp, tag);
    await page.goto(process.env.READONLY_URL + '/login'); await page.fill('#email', 'admin@tessera.test'); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL('**/dashboard');
    await page.goto(process.env.READONLY_URL + '/settings/aran'); await page.waitForLoadState('networkidle');
    check((await page.locator('main').innerText()).includes('configured by environment variables'), `${tag}: read-only banner missing`);
    check(await page.locator('#aran-url').isDisabled(), `${tag}: fields are not disabled in read-only mode`);
    check(await page.locator('button:has-text("Save")').isDisabled(), `${tag}: Save is not disabled in read-only mode`);
    await shot(page, 'read-only', tag); await ctx.close();
  }
}

await browser.close();
console.log(`screenshots: ${shots} in ${OUT}`);
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('OK: admin saves, tests, sees a rejected key and an unreachable address, disconnects; other roles are denied; no key in any page or response; no console errors, no horizontal scroll');
