// Screenshots of the shared primitives at the three wireframe widths (1280,
// 834, 390), for comparing a build against plans/ffb-wireframes.html: the
// dashboard (primary pill, filter chips, cards), an expanded household with its
// action menu, the Record Payment dialog (inputs, footer pills), the empty
// reviews tab and the bills action menu. Runs against the E2E build:
//
//   VITE_E2E_MODE=true npm run build:react && npm run build:assemble
//   PORT=4176 node scripts/e2e-server.mjs &
//   PORT=4176 node tests/e2e/screenshots.mjs /tmp/shots
//
// Writes <name>-<desk|tab|ph>.png to the directory given as argv[2].
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { seedPage } from './fixtures.js';

const out = process.argv[2];
const PORT = process.env.PORT || '4174';
mkdirSync(out, { recursive: true });
const WIDTHS = [['desk', 1280, 800], ['tab', 834, 1112], ['ph', 390, 844]];

const browser = await chromium.launch();
for (const [tag, width, height] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await seedPage(page);
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });

    await page.goto('http://localhost:' + PORT + '/dashboard');
    await page.waitForSelector('.settlement-filter-chip');
    await page.evaluate(() => document.fonts.ready);
    await shot('dashboard');

    // Expand the first household, then open its action menu (icon trigger + popover).
    await page.locator('.settlement-card-main').first().click();
    await page.waitForSelector('.settlement-detail-actions');
    await shot('dashboard-expanded');
    const menu = page.getByRole('button', { name: /^More actions for/ }).first();
    await menu.click();
    await page.waitForSelector('[role="menu"]');
    await shot('dashboard-menu');
    await page.keyboard.press('Escape');

    // Record Payment dialog: 8 px inputs, pill footer buttons.
    await page.getByRole('button', { name: 'Record Payment' }).first().click();
    await page.waitForSelector('.dialog');
    await shot('dialog-record-payment');
    await page.keyboard.press('Escape');

    await page.goto('http://localhost:' + PORT + '/manage/reviews');
    await page.waitForSelector('.empty-state');
    await shot('reviews-empty');

    await page.goto('http://localhost:' + PORT + '/manage/bills');
    await page.waitForSelector('.bill-card');
    await page.getByRole('button', { name: /^Actions for/ }).first().click();
    await page.waitForSelector('[role="menu"]');
    await shot('bills-menu');
    await page.keyboard.press('Escape');

    await ctx.close();
}
await browser.close();
console.log('wrote screenshots to', out);
