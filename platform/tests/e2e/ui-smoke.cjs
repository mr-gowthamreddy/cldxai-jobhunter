// Browser smoke test of every page (needs a running server, Playwright and jobs in the DB).
//   BASE_URL=http://localhost:4300 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:ui
// Fails on any console error, page error or failed /api request.
const { chromium } = require('playwright');
const S = process.env.SHOTS_DIR || require('node:os').tmpdir(); const BASE = process.env.BASE_URL || 'http://localhost:4300';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (an admin account on the target server)."); process.exit(2); }
const FIX = require('node:path').join(__dirname, '..', 'fixtures') + '/';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(dark = false) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${p.url()} ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`[pageerror] ${p.url()} ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`[http ${r.status()}] ${r.url()}`); });
    return p;
  }
  const shot = (p, n) => p.screenshot({ path: `${S}/${n}.png`, fullPage: false });
  const p = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.hero'); await shot(p, '01-landing');
  await p.click('text=Get started'); await p.waitForSelector('form');
  const email = `asha.${Date.now()}@example.com`;
  const inputs = p.locator('form input');
  await inputs.nth(0).fill('Asha Verma'); await inputs.nth(1).fill(email); await inputs.nth(2).fill('StrongPass123'); await inputs.nth(3).fill('StrongPass123');
  await shot(p, '02-register');
  await p.click('button[type=submit]');
  await p.waitForURL('**/app/resumes**');
  await p.setInputFiles('#resume-file', FIX + 'data-engineer.pdf');
  await p.waitForSelector('text=Extracted candidate profile', { timeout: 30000 });
  await p.waitForTimeout(2500);
  await shot(p, '03-resumes');
  await p.goto(BASE + '/app'); await p.waitForSelector('text=Top matches for you'); await p.waitForTimeout(1500); await shot(p, '04-dashboard');
  await p.goto(BASE + '/app/jobs?category=databricks'); await p.waitForSelector('.job-card', { timeout: 20000 }); await p.waitForTimeout(800); await shot(p, '05-jobs');
  await p.locator('.job-card .job-title').first().click(); await p.waitForSelector('text=Why this job matches you'); await shot(p, '06-job-detail');
  await p.click('button:has-text("Save")'); await p.waitForTimeout(500);
  await p.click('button:has-text("Track")'); await p.waitForSelector('.modal'); await p.selectOption('.modal select', 'Applied'); await p.click('.modal button[type=submit]'); await p.waitForTimeout(800);
  await p.goto(BASE + '/app/recommendations'); await p.waitForSelector('.job-card, .empty', { timeout: 20000 }); await shot(p, '07-recommendations');
  await p.goto(BASE + '/app/saved'); await p.waitForSelector('.job-card, .empty'); await shot(p, '08-saved');
  await p.goto(BASE + '/app/applications'); await p.waitForSelector('.kanban'); await p.waitForTimeout(800); await shot(p, '09-applications');
  await p.click('button:has-text("Add job manually")'); const mi = p.locator('.modal input'); await mi.nth(0).fill('Acme Corp'); await mi.nth(1).fill('BI Developer'); await p.click('.modal button[type=submit]'); await p.waitForURL('**/app/applications/*'); await shot(p, '10-app-detail');
  await p.goto(BASE + '/app/applications?view=table'); await p.waitForSelector('table'); await shot(p, '11-app-table');
  await p.goto(BASE + '/app/profile?tab=preferences'); await p.waitForSelector('text=Target job titles'); await p.locator('.tags input').first().fill('Data Engineer'); await p.keyboard.press('Enter'); await p.click('button:has-text("Save preferences")'); await p.waitForTimeout(600); await shot(p, '12-preferences');
  for (const t of ['profile', 'searches', 'security']) { await p.goto(BASE + `/app/profile?tab=${t}`); await p.waitForTimeout(500); }
  await p.goto(BASE + '/app/notifications'); await p.waitForTimeout(600); await shot(p, '13-notifications');
  await p.goto(BASE + '/admin'); await p.waitForTimeout(600); const denied = await p.locator('text=Administrators only').count(); console.log('non-admin admin denied:', denied > 0);
  // mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + '/'); await m.screenshot({ path: `${S}/14-mobile-landing.png` });
  // admin, dark mode
  const a = await newPage(true);
  await a.goto(BASE + '/login'); await a.fill('input[type=email]', ADMIN_EMAIL); await a.fill('input[type=password]', ADMIN_PASSWORD); await a.click('button[type=submit]'); await a.waitForURL('**/app');
  for (const sct of ['', 'users', 'activity', 'resumes', 'jobs', 'duplicates', 'sources', 'fetching', 'sheets', 'errors', 'settings']) {
    await a.goto(BASE + '/admin' + (sct ? `/${sct}` : '')); await a.waitForTimeout(1200); await shot(a, `20-admin-${sct || 'overview'}`);
  }
  await a.goto(BASE + '/app/jobs'); await a.waitForSelector('.job-card'); await shot(a, '30-dark-jobs');
  console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
