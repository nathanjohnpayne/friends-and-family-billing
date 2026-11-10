// Screenshots and geometry of the shared Dialog primitive (#527, RD-14) at the
// three wireframe widths (1280, 834, 390), for comparing a build against the
// dialog frames in plans/ffb-wireframes.html: Record Payment, Email Invoice,
// Share Links, Payment History, Edit Payment and Reverse Payment stacked over
// Payment History, and the Remove bill confirmation. Runs against the E2E build:
//
//   VITE_E2E_MODE=true npm run build:react && npm run build:assemble
//   PORT=4176 node scripts/e2e-server.mjs &
//   PORT=4176 node tests/e2e/dialog-screenshots.mjs /tmp/dialog-shots
//
// Writes <name>-<desk|tab|ph>.png and report.json (each topmost dialog's box,
// its footer's bottom edge, whether the grab handle shows, and what has focus)
// to the directory given as argv[2]. At 390 every dialog should be a
// full-width sheet whose footer bottom equals the viewport height.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { seedPage } from './fixtures.js';

const out = process.argv[2];
const PORT = process.env.PORT || '4174';
mkdirSync(out, { recursive: true });
const WIDTHS = [['desk', 1280, 800], ['tab', 834, 1112], ['ph', 390, 844]];
const report = [];

const browser = await chromium.launch();
for (const [tag, width, height] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await seedPage(page);
    const base = 'http://localhost:' + PORT;

    async function capture(name) {
        await page.waitForTimeout(300); // let the phone sheet finish sliding up
        const geometry = await page.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
            const top = dialogs[dialogs.length - 1];
            const box = top.getBoundingClientRect();
            const footer = top.querySelector('.dialog-buttons');
            const active = document.activeElement;
            return {
                open: dialogs.length,
                top: Math.round(box.top),
                left: Math.round(box.left),
                width: Math.round(box.width),
                footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
                viewportHeight: innerHeight,
                grabHandle: getComputedStyle(top.querySelector('.dialog-grab')).display !== 'none',
                focusInside: top.contains(active)
            };
        });
        report.push({ name, tag, ...geometry });
        await page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
    }

    await page.goto(base + '/dashboard');
    await page.waitForSelector('.settlement-filter-chip');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.settlement-card-main').first().click();
    await page.waitForSelector('.settlement-detail-actions');

    await page.getByRole('button', { name: 'Record Payment' }).first().click();
    await capture('record-payment');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^More actions for/ }).first().click();
    await page.getByRole('menuitem', { name: 'Email Invoice' }).click();
    await capture('email-invoice');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^More actions for/ }).first().click();
    await page.getByRole('menuitem', { name: 'Manage Share Links' }).click();
    await capture('share-links');
    await page.keyboard.press('Escape');

    // Record a payment so Payment History has a row to edit and reverse.
    await page.getByRole('button', { name: 'Record Payment' }).first().click();
    await page.getByLabel('Amount ($)').fill('25');
    await page.getByRole('button', { name: 'Save Payment' }).click();
    await page.getByRole('button', { name: 'Payment History' }).first().click();
    await capture('payment-history');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await capture('payment-edit-stacked');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '×' }).first().click();
    await capture('confirm-reverse-stacked');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(base + '/manage/bills');
    await page.waitForSelector('.bill-card');
    await page.getByRole('button', { name: /^Actions for/ }).first().click();
    await page.getByRole('menuitem', { name: /Remove/ }).first().click();
    await capture('confirm-remove-bill');
    await page.keyboard.press('Escape');

    await ctx.close();
}
await browser.close();
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log('Wrote ' + report.length + ' screenshots to ' + out);
