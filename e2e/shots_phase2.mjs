// Screenshot helper (not a test) for design review of the shells: node shots_phase2.mjs <out-dir>
import { chromium } from 'playwright';
import path from 'node:path';
const OUT = path.resolve(process.argv[2] || '../docs/screens/phase2');
const ARAN = 'http://127.0.0.1:8100', BANK = process.env.BANK_URL || 'http://127.0.0.1:3000';
const b = await chromium.launch(); const errs = [];
const ws = await (await fetch(ARAN + '/v1/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Shells ' + Date.now(), email: 's@demo.test' }) })).json();
for (const [t, vp] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(`${t}: ${m.text()}`)); p.on('pageerror', (e) => errs.push(`${t}: ${e.message}`));
  const shot = async (n) => { await p.waitForTimeout(400); const o = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (o[0] > o[1] + 1) errs.push(`${n}-${t} hscroll ${o}`); await p.screenshot({ path: `${OUT}/${n}-${t}.png`, fullPage: true }); };
  await p.goto(ARAN + '/'); await p.waitForSelector('#demo-meta .pill', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1200); await shot('console-landing');
  await p.goto(ARAN + '/dashboard'); await p.evaluate((k) => sessionStorage.setItem('aran_key', k), ws.admin_key); await p.goto(ARAN + '/dashboard#overview'); await p.reload(); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1200); await shot('console-dashboard');
  await p.goto(BANK + '/login'); await p.waitForLoadState('networkidle'); await shot('bank-login');
  await p.fill('#email', 'admin@tessera.test'); await p.fill('#password', 'Tessera-demo-1'); await p.click('button[type=submit]'); await p.waitForURL('**/dashboard'); await p.waitForLoadState('networkidle'); await shot('bank-dashboard');
  await ctx.close();
}
await b.close(); console.log('console errors:', errs.length); if (errs.length) console.log([...new Set(errs)].join('\n'));
