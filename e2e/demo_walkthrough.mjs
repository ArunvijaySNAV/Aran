// Rehearsal walkthrough of docs/DEMO_SCRIPT.md, driven like the presenter (not a test suite): it follows the script step by step,
// prints what it actually saw, and marks every place where reality differs from the script's expectation with DIFF.
// WRITES DATA: onboards one customer, opens an account, posts a transaction, reveals, erases, builds a vendor export.
// Run it against a THROWAWAY Aran workspace (an erased customer reference is burned for ever in the workspace it was erased in), e.g.:
//   BANK_URL=http://127.0.0.1:3300 ARAN_ADMIN_KEY=<admin key of the throwaway workspace> node e2e/demo_walkthrough.mjs
import { chromium } from 'playwright';

const ARAN = process.env.ARAN_URL || 'http://127.0.0.1:8100';
const BANK = process.env.BANK_URL || 'http://127.0.0.1:3100';
const ADMIN_KEY = process.env.ARAN_ADMIN_KEY;
const PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Tessera-demo-1';
if (!ADMIN_KEY) { console.error('ARAN_ADMIN_KEY is required (the console steps paste it)'); process.exit(2); }

// the values used in the script (each verified with bank/lib/validators.ts: Verhoeff, Luhn, 10-digit mobile 6-9, PAN shape)
const V = {
  landingAadhaar: '343950504654',
  cust: { name: 'Anjali Verma', mobile: '7432972377', aadhaar: '652301019164', pan: 'CFLPH7375C', card: '4247108646585311', loan: '150000' },
  support: { card: '4549955977661482', aadhaar: '402079608370', mobile: '9860183355' },
};
// Aran gives an identifier to the customer reference that FIRST presented it: onboarding the same Aadhaar/mobile/PAN/card again under a new
// reference reuses the first owner's tokens, so erasing the new reference does not make them unreadable. Use a fresh set for every run in the same workspace.
const SETS = {
  spare1: { name: 'Rohan Iyer', mobile: '9617326009', aadhaar: '986363938813', pan: 'YAOPJ0578A', card: '4179350466188048', loan: '150000' },
  spare2: { name: 'Kavita Menon', mobile: '6743012187', aadhaar: '670917204747', pan: 'VNSPM9157U', card: '4615601807485697', loan: '150000' },
};
if (SETS[process.env.DEMO_SET]) V.cust = SETS[process.env.DEMO_SET];
const diffs = []; const lines = [];
const note = (id, ok, text) => { const l = `${ok ? 'OK  ' : 'DIFF'} ${id}: ${text}`; lines.push(l); console.log(l); if (!ok) diffs.push(l); };
const step = async (id, fn) => { try { await fn(); } catch (e) { note(id, false, `step failed: ${String(e.message).split('\n')[0].slice(0, 220)}`); } };
const short = (s, n = 160) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

const browser = await chromium.launch();
const errors = [];
async function open(w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/429/.test(m.text())) errors.push(`${page.url()}: ${m.text().slice(0, 140)}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message.slice(0, 140)}`));
  return { ctx, page };
}
const login = async (page, who) => { await page.goto(BANK + '/login'); await page.fill('#email', `${who}@tessera.test`); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL('**/dashboard'); };
const navItems = (page) => page.locator('nav[aria-label=Main] a').allTextContents().then((a) => a.map((x) => x.trim()));

let ref = null;

// ============================================================ 1. console landing
{
  const { ctx, page } = await open();
  await step('1.1 landing hero', async () => {
    await page.goto(ARAN + '/'); await page.waitForLoadState('networkidle');
    const first = await page.inputValue('#digits'); const v0 = await page.locator('#verdict').textContent();
    note('1.1a', /Passes the Verhoeff checksum: a usable Aadhaar/.test(v0), `the plate opens on a sample number (${first.replace(/\d(?=\d{4})/g, '•')}) with the red verdict "${short(v0)}"`);
    await page.fill('#digits', V.landingAadhaar); await page.waitForTimeout(200);
    const v1 = await page.locator('#verdict').textContent();
    note('1.1b', /Passes the Verhoeff/.test(v1), `typing ${V.landingAadhaar} keeps the red verdict: "${short(v1)}"`);
    await page.click('#protectBtn'); await page.waitForTimeout(2200);
    const tok = await page.inputValue('#digits'); const v2 = await page.locator('#verdict').textContent();
    note('1.1c', /Fails the Verhoeff checksum: cannot be an Aadhaar/.test(v2) && tok.replace(/\s/g, '') !== V.landingAadhaar, `after Protect this number the digits are a token (${tok}) and the verdict is "${short(v2)}"`);
    await page.click('#sinks button[data-s="crm"]'); await page.waitForTimeout(2000);
    const tok2 = await page.inputValue('#digits'); note('1.1d', tok2 !== tok, `choosing the crm sink re-rolls to a different token (${tok} -> ${tok2})`);
  });
  await step('1.2 flight with a real call', async () => {
    await page.locator('#demo').scrollIntoViewIfNeeded(); await page.click('#demo-run'); await page.waitForTimeout(3500);
    const meta = await page.locator('#demo-meta').innerText(); const before = await page.locator('#demo-before').innerText(); const after = await page.locator('#demo-after').innerText();
    note('1.2', before.trim().length > 20 && after.trim().length > 20 && /ms|protected|token/i.test(meta + after), `Run again fills both panes; meta line: "${short(meta, 120)}"; right pane starts: "${short(after, 90)}"`);
  });
  await step('1.3 erase illustration', async () => {
    await page.locator('#shredBtn').scrollIntoViewIfNeeded(); await page.click('#shredBtn'); await page.waitForTimeout(2500);
    note('1.3', true, `Crypto-shred purpose key -> status line: "${short(await page.locator('#shredStatus').innerText(), 120)}"`);
  });
  await ctx.close();
}

// ============================================================ 3. console connect: a real test event
{
  const { ctx, page } = await open();
  await step('3 connect', async () => {
    await page.goto(ARAN + '/connect'); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForLoadState('networkidle');
    note('3.0', await page.locator('#need-key').isVisible(), 'without a key the page asks "Paste a key to continue"');
    await page.fill('#k', ADMIN_KEY); await page.click('#key-form button[type=submit]'); await page.waitForSelector('#flow:not([hidden])', { timeout: 15000 });
    note('3.1', await page.locator('.rail-step.done').count() >= 1, `after pasting the key, step 01 "Create a key" is ticked and the base URL is ${short(await page.locator('#base').innerText(), 60)}`);
    await page.click('#test'); await page.waitForFunction(() => /arrived|received|Event/i.test(document.querySelector('#status-text')?.textContent || ''), null, { timeout: 20000 });
    note('3.2', true, `Send a test event -> status: "${short(await page.locator('#status-text').innerText(), 120)}"; output: "${short(await page.locator('#test-out').innerText(), 200)}"`);
  });
  await ctx.close();
}

// ============================================================ 4. bank: KYC officer
{
  const { ctx, page } = await open();
  await step('4.0 kyc login', async () => {
    await login(page, 'kyc');
    note('4.0', true, `KYC officer dashboard: "${short(await page.locator('h1').first().textContent(), 40)}"; nav: ${(await navItems(page)).join(' | ')}; stats: ${short(await page.locator('main .edge, main section').first().innerText().catch(() => ''), 0)}${short(await page.locator('main').innerText(), 150)}`);
  });
  await step('4.1 customers list', async () => {
    await page.goto(BANK + '/customers'); await page.waitForLoadState('networkidle');
    const hdr = await page.locator('table[aria-label=Customers] thead th').allTextContents();
    const row = await page.locator('table[aria-label=Customers] tbody tr').first().innerText();
    note('4.1', hdr.length >= 5 && /PER:|MOBILE:/.test(row), `customers table columns: ${hdr.join(' | ')}; first row: ${short(row, 140)}`);
  });
  let onboardRedirected = true;
  await step('4.2 onboard', async () => {
    await page.click('text=Onboard a customer'); await page.waitForURL('**/customers/new'); await page.waitForLoadState('networkidle');
    note('4.2a', /Step 1 of 3: Identity/.test(await page.locator('main').innerText()), 'onboarding opens on "Step 1 of 3: Identity"');
    await page.fill('#name', V.cust.name); await page.fill('#mobile', V.cust.mobile); await page.click('text=Continue');
    await page.waitForSelector('#aadhaar', { state: 'visible', timeout: 10000 });
    note('4.2b', /Step 2 of 3/.test(await page.locator('main').innerText()), 'Continue moves to "Step 2 of 3: Identifiers"');
    const wrong = V.cust.aadhaar.slice(0, 11) + String((Number(V.cust.aadhaar[11]) + 1) % 10);
    await page.fill('#aadhaar', wrong); await page.click('text=Continue');   // wrong check digit on purpose
    await page.waitForSelector('#aadhaar-err', { timeout: 5000 });
    note('4.2c', true, `a wrong check digit (…315 instead of …314 typed as ${V.cust.aadhaar.slice(0, 11)}5) is refused inline: "${short(await page.locator('#aadhaar-err').innerText(), 100)}"`);
    await page.fill('#aadhaar', V.cust.aadhaar); await page.fill('#pan', V.cust.pan); await page.fill('#card', V.cust.card); await page.click('text=Continue');
    await page.waitForSelector('input[name=loanInterest]', { state: 'visible', timeout: 10000 });
    await page.check('input[name=loanInterest]'); await page.waitForSelector('#loanAmount'); await page.fill('#loanAmount', V.cust.loan);
    note('4.2d', /Step 3 of 3/.test(await page.locator('main').innerText()), 'step 3 shows the consent box and, once ticked, the loan amount');
    await page.click('text=Onboard customer');
    const t0 = Date.now();
    onboardRedirected = await page.waitForURL('**/customers/CUS-*', { timeout: 15000 }).then(() => true).catch(() => false);
    if (onboardRedirected) { ref = page.url().match(/CUS-\d+/)[0]; note('4.2e', true, `after Onboard customer the page goes to ${ref} in ${Date.now() - t0} ms with the banner "${short(await page.locator('main [role=status]').first().innerText().catch(() => ''), 90)}"`); }
    else note('4.2e', false, 'REDIRECT FLAKE: still on /customers/new 15 s after Onboard customer (the customer is saved; see recovery sheet)');
  });
  if (!onboardRedirected) await step('4.2f recover', async () => {
    // what the presenter does on stage, in order: wait a moment, open Customers, click the newest row; if that hangs too, reload and click again; last resort: type the address
    await page.goto(BANK + '/customers'); await page.waitForLoadState('networkidle');
    const first = await page.locator('table[aria-label=Customers] tbody tr').first().innerText();
    ref = first.match(/CUS-\d+/)[0];
    note('4.2f-1', /active/.test(first), `Customers lists the new customer as the first row (${ref}): "${short(first, 100)}"`);
    const clickRow = () => page.click(`a:has-text("${ref}")`).then(() => page.waitForURL('**/customers/CUS-*', { timeout: 8000 })).then(() => true).catch(() => false);
    if (await clickRow()) { note('4.2f-2', true, 'clicking the first row opened the customer page'); return; }
    note('4.2f-2', false, 'clicking the first row did NOT open the customer page within 8 s (soft navigation stuck as well)');
    await page.reload(); await page.waitForLoadState('networkidle');
    if (await clickRow()) { note('4.2f-3', true, 'after a browser reload (F5) the click worked'); return; }
    note('4.2f-3', false, 'still stuck after a reload');
    await page.goto(BANK + '/customers/' + ref); note('4.2f-4', true, 'typing the address /customers/' + ref + ' worked');
  });
  await step('4.3 customer detail', async () => {
    const txt = await page.locator('main').innerText();
    const ident = await page.locator('table[aria-label=Identifiers] tbody tr').allInnerTexts();
    note('4.3a', !txt.includes(V.cust.aadhaar) && !txt.includes(V.cust.mobile) && !txt.includes(V.cust.card), `identifiers are tokens, none of the typed values is on the page: ${ident.map((r) => short(r, 70)).join(' // ')}`);
    note('4.3b', /Only compliance officers can reveal/.test(txt), `the KYC officer sees "Only compliance officers can reveal" and no Reveal button (${await page.locator('button:has-text("Reveal")').count()} Reveal buttons)`);
    note('4.3c', /KYC cases/.test(txt) && await page.locator('button:has-text("Approve")').count() === 1, `an open KYC case with Approve / Reject (${await page.locator('button:has-text("Reject")').count()} Reject)`);
  });
  await step('4.4 account and transaction', async () => {
    await page.goto(BANK + '/accounts?ref=' + ref); await page.waitForLoadState('networkidle');
    await page.fill('#oa-open', '25000'); await page.click('text=Open account'); await page.waitForSelector('text=opened', { timeout: 20000 });
    note('4.4a', true, `Open account with ₹25,000 -> "${short(await page.locator('main [role=status]').first().innerText(), 80)}"`);
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.locator('tbody tr').first().locator('a').first().click(); await page.waitForURL('**/accounts/TSB*');
    await page.fill('#tx-amt', '1200'); await page.fill('#tx-desc', `Salary credit, call me on ${V.cust.mobile}`); await page.click('text=Post transaction');
    await page.waitForSelector('text=New balance', { timeout: 20000 }); const bal = short(await page.locator('main [role=status]').first().innerText(), 80);
    await page.waitForTimeout(1500); const seen = (await page.locator('table[aria-label=Statement] tbody tr').allInnerTexts()).map((r) => short(r, 110));
    note('4.4b', seen.length >= 2 && !seen.join(' ').includes(V.cust.mobile), `posting ₹1,200 with the mobile number in the description -> "${bal}"; statement rows: ${seen.join(' // ')}`);
    note('4.4c', true, `the statement without a reload shows ${seen.length} row(s) (the new one appears after the page refreshes itself)`);
  });
  await ctx.close();
}

// ============================================================ 4b. support agent
{
  const { ctx, page } = await open();
  await step('5 support', async () => {
    await login(page, 'support');
    note('5.0', true, `support agent nav: ${(await navItems(page)).join(' | ')}`);
    await page.goto(BANK + '/customers/' + ref); await page.waitForLoadState('networkidle');
    note('5.1', /Only compliance officers can reveal/.test(await page.locator('main').innerText()) && await page.locator('button:has-text("Approve")').count() === 0, 'support sees the customer tokens read-only: no Reveal, no Approve/Reject');
    await page.goto(BANK + '/support'); await page.waitForLoadState('networkidle');
    await page.fill('#ref', ref); await page.fill('#prompt', `Customer says card ${V.support.card} was blocked and her Aadhaar ${V.support.aadhaar} is on file. Call ${V.support.mobile}.`);
    await page.click('button:has-text("Ask")'); await page.waitForSelector('text=What the AI provider saw', { timeout: 30000 });
    const pane = await page.locator('.night').filter({ hasText: 'What the AI provider saw' }).innerText(); const answer = await page.locator('section:has-text("Answer to you")').first().innerText();
    note('5.2a', !pane.includes(V.support.card) && !pane.includes(V.support.aadhaar) && !pane.includes(V.support.mobile), `the provider pane shows placeholders only: "${short(pane, 170)}"`);
    note('5.2b', true, `answer to the agent: "${short(answer, 200)}"`);
  });
  await ctx.close();
}

// ============================================================ 4c. compliance officer
let erased = false;
{
  const { ctx, page } = await open();
  await step('6 compliance', async () => {
    await login(page, 'compliance');
    note('6.0', true, `compliance officer nav: ${(await navItems(page)).join(' | ')}`);
    await page.goto(BANK + '/customers/' + ref); await page.waitForLoadState('networkidle');
    await page.click('text=Reveal Aadhaar'); await page.fill('#reason-aadhaar', 'RBI audit request 114: verify identity of account holder');
    await page.click('form button[type=submit]:has-text("Reveal")'); await page.waitForSelector('[role=status]:has-text("Hides in")', { timeout: 30000 });
    const shown = (await page.locator('[role=status]:has-text("Hides in")').first().innerText()).split('\n');
    note('6.1', shown[0].trim() === V.cust.aadhaar, `Reveal Aadhaar with a reason shows the original value ${shown[0].trim() === V.cust.aadhaar ? '(matches what was typed)' : '(DOES NOT match: ' + shown[0].trim() + ')'} and "${short(shown.slice(1).join(' '), 80)}"`);
    await page.click('text=Hide now');
    const histBefore = await page.locator('table[aria-label=Reveals] tbody tr').count();
    await page.reload(); await page.waitForLoadState('networkidle');
    const hist = await page.locator('table[aria-label=Reveals] tbody tr').first().innerText();
    note('6.2', /aadhaar/.test(hist), `Reveal history ${histBefore ? 'updates by itself' : 'appears only after the page is reloaded'}; row: "${short(hist, 120)}"`);
    await page.click('text=Reveal Mobile'); await page.fill('#reason-mobile', 'Same audit request: confirm the contact number'); await page.click('form button[type=submit]:has-text("Reveal")');
    await page.waitForSelector('[role=status]:has-text("Hides in")', { timeout: 30000 });
    note('6.3', (await page.locator('[role=status]:has-text("Hides in")').first().innerText()).startsWith(V.cust.mobile), 'Reveal Mobile also works and returns the typed mobile'); await page.click('text=Hide now');
    // erase
    await page.goto(BANK + '/compliance'); await page.waitForLoadState('networkidle');
    await page.fill('#er-ref', ref); await page.fill('#er-confirm', ref); await page.click('text=Erase this customer');
    await page.waitForSelector('text=signed receipts issued', { timeout: 40000 }); erased = true;
    note('6.4', true, `erase -> "${short(await page.locator('text=signed receipts issued').first().textContent(), 60)}"; certificate: ${await page.locator('section[aria-label="Erasure certificate"]').count() === 1 ? 'shown' : 'missing'}`);
    await page.click('button:has-text("Verify receipt") >> nth=0'); await page.waitForSelector('text=Valid:', { timeout: 30000 });
    note('6.5', true, `Verify receipt -> "${short(await page.locator('text=Valid:').first().textContent(), 100)}"`);
    const dead = await page.locator('table[aria-label="Token resolution after erasure"] tbody tr').allInnerTexts();
    note('6.6', dead.length >= 3 && dead.every((r) => /erased\s*$/.test(r.trim())), `tokens after erasure: ${dead.map((r) => short(r.replace(/\s+/g, ' '), 50)).join(' // ')}`);
    await page.goto(BANK + '/customers/' + ref); await page.waitForLoadState('networkidle');
    note('6.7', /erased/i.test(await page.locator('main').innerText()) && await page.locator('button:has-text("Reveal")').count() === 0, 'the customer page now says erased and offers no Reveal');
  });
  await ctx.close();
}

// ============================================================ 4d. admin
{
  const { ctx, page } = await open();
  await step('7 admin', async () => {
    await login(page, 'admin');
    note('7.0', true, `administrator nav: ${(await navItems(page)).join(' | ')}`);
    await page.goto(BANK + '/data-plane'); await page.waitForLoadState('networkidle');
    const secs = await page.locator('main h2').allTextContents();
    note('7.1', secs.length >= 6, `Data plane sections: ${secs.map((s) => short(s, 40)).join(' | ')}`);
    await page.click('text=Scan for plaintext'); await page.waitForSelector('text=Clean.', { timeout: 40000 });
    note('7.2', true, `Scan for plaintext -> "${short(await page.locator('text=Clean.').first().locator('xpath=..').innerText(), 200)}"`);
    await page.goto(BANK + '/vendor'); await page.waitForLoadState('networkidle');
    const waiting = short(await page.locator('main').innerText(), 90);
    await page.click('text=Build CSV export'); await page.waitForSelector('text=Simulate vendor breach', { timeout: 30000 }); await page.waitForTimeout(2500); await page.reload(); await page.waitForLoadState('networkidle');   // the new batch is at the top after a moment (reload if it is not)
    note('7.3', true, `vendor page before: "${waiting}"; Build CSV export -> newest batch: "${short(await page.locator('pre').first().innerText(), 160)}"`);
    await page.click('text=Simulate vendor breach >> nth=0'); await page.waitForFunction(() => /Leak traced|No Aran tokens recognised/.test(document.body.innerText), null, { timeout: 30000 });
    const traced = /Leak traced to the “loan-vendor” destination/.test(await page.locator('main').innerText());
    note('7.4', traced, `Simulate vendor breach -> ${short(await page.locator('main').innerText().then((t) => (t.match(/Leak traced[^.]*\.[^.]*\.|No Aran tokens recognised[^.]*\./) || ['(no result text)'])[0]), 200)}`);
    const rows = await page.locator('table[aria-label="Trace result"] tbody tr').allInnerTexts();
    note('7.5', rows.length > 0, `trace rows: ${rows.length}; first: ${short(rows[0] || '', 80)}`);
    await page.goto(BANK + '/settings/aran'); await page.waitForLoadState('networkidle');
    note('7.6', true, `Aran connection page: status "${await page.locator('[data-aran-status]').first().getAttribute('data-aran-status')}", source: ${short((await page.locator('dl').first().innerText()).replace(/\n/g, ' '), 160)}`);
    await page.click('button:has-text("Test connection")'); await page.waitForSelector('text=All checks passed', { timeout: 40000 });
    note('7.7', true, `Test connection -> "All checks passed" with ${await page.locator('main section[aria-label] li').count()} separate checks`);
  });
  await ctx.close();
}

// ============================================================ 5. back to the console dashboard: audit tab
{
  const { ctx, page } = await open();
  await step('8 dashboard audit', async () => {
    await page.goto(ARAN + '/dashboard'); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForLoadState('networkidle');
    await page.fill('#key', ADMIN_KEY); await page.click('#signin-form button[type=submit]'); await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
    note('8.0', true, `signed in with the admin key; sidebar: ${(await page.locator('#nav a, #nav button').allTextContents()).map((s) => s.trim()).join(' | ')}`);
    await page.click('#nav >> text=Audit'); await page.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 15000 }); await page.waitForTimeout(500);
    const rows = await page.locator('#view table tbody tr').count(); const body = await page.locator('#view').innerText();
    note('8.1', rows >= 2, `Audit tab lists ${rows} detokenise rows; columns/first row: "${short(body, 200)}"`);
    await page.click('#view button:has-text("Verify chain")'); await page.waitForSelector('text=Chain intact', { timeout: 20000 });
    note('8.2', true, `Verify chain -> "${short(await page.locator('text=Chain intact').first().locator('xpath=..').innerText(), 100)}"`);
    await page.click('#nav >> text=Erasure & receipts'); await page.waitForTimeout(1200);
    note('8.3', true, `Erasure and receipts tab: "${short(await page.locator('#view').innerText(), 160)}"`);
  });
  await ctx.close();
}

await browser.close();
console.log(`\nconsole errors seen: ${errors.length}${errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : ''}`);
console.log(`\n${diffs.length} place(s) where reality differs from the script${diffs.length ? ':\n' + diffs.join('\n') : '.'}`);
