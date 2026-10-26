// The two Friends & Family Billing images on the nathanpayne.com case study,
// re-created from the E2E build because the live app needs the owner's sign-in:
// the dashboard hero (top of the page through the second household card) and
// the per-bill calculation for the first, expanded household. Runs against the
// E2E build, with .env.local present so VITE_LOGODEV_KEY is baked in:
//
//   VITE_E2E_MODE=true npm run build:react && npm run build:assemble
//   PORT=4176 node scripts/e2e-server.mjs &
//   PORT=4176 node tests/e2e/case-study-screenshots.mjs /tmp/case-study
//
// Writes hero.png and household.png to the directory given as argv[2]. They
// are published in nathanjohnpayne/nathanpaynedotcom as
// public/images/projects/friends-and-family-billing-hero-v4.png and
// friends-and-family-billing-household-v2.png; bump the suffix on re-capture.
// Only Nathan Payne and John Payne are real names; every other member is
// invented. Keep the bill amounts in step with the case study copy (T-Mobile
// $450.00, Apple One $75.90, 1Password $17.96, total $543.86 for the first
// household).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { seedPage, E2E_DATA, E2E_USER } from './fixtures.js';

const out = process.argv[2];
const PORT = process.env.PORT || '4176';
const SCALE = Number(process.env.SCALE || 3);
mkdirSync(out, { recursive: true });

// Nine members in five households; three linked groups.
const m = (id, name, linkedMembers = []) => ({ id, name, email: '', phone: '', avatar: '', linkedMembers, paymentReceived: 0 });
const familyMembers = [
    m(1, 'Nathan Payne', [2]), m(2, 'Sterling Payne'),
    m(3, 'John Payne', [4]), m(4, 'Margaret Payne'),
    m(5, 'Riley Chen', [6, 7]), m(6, 'Jordan Chen'), m(7, 'Sam Chen'),
    m(8, 'Morgan Ellis'),
    m(9, 'Taylor Brooks'),
];
const bills = [
    { id: 101, name: 'T-Mobile', amount: 300, billingFrequency: 'monthly', website: 'https://www.t-mobile.com', members: [1, 2, 3, 4, 5, 6, 8, 9] },
    { id: 102, name: 'Apple One', amount: 37.95, billingFrequency: 'monthly', website: 'https://www.apple.com', members: [1, 2, 3, 4, 5, 7] },
    { id: 103, name: '1Password', amount: 53.88, billingFrequency: 'annual', website: 'https://1password.com', members: [1, 3, 5] },
];
// Every member has paid exactly their annual share.
const annual = (b) => (b.billingFrequency === 'annual' ? b.amount : b.amount * 12) / b.members.length;
const payments = familyMembers.map((mem, i) => ({
    id: 'pay_' + mem.id,
    memberId: mem.id,
    amount: Math.round(bills.filter(b => b.members.includes(mem.id)).reduce((s, b) => s + annual(b), 0) * 100) / 100,
    receivedAt: new Date(Date.UTC(2026, 1, 2 + i)).toISOString(),
    note: '',
    method: 'venmo',
}));
const year = { id: '2026', label: '2026', status: 'settling', createdAt: null, archivedAt: null };
const state = { ...E2E_DATA, billingYears: [{ id: '2026', label: '2026', status: 'settling' }], activeYear: year, familyMembers, bills, payments, billingEvents: [] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 1400 }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
await seedPage(page, { user: { ...E2E_USER, displayName: 'Nathan Payne' }, state });
// CompanyLogo asks Logo.dev for 2x its CSS size; ask for SCALE x 2 so the
// 16 px bill logos stay sharp at the capture scale.
await page.route('https://img.logo.dev/**', (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('size', String(16 * SCALE * 2));
    route.continue({ url: u.toString() });
});

await page.goto('http://localhost:' + PORT + '/dashboard');
await page.waitForSelector('.settlement-filter-chip');
await page.locator('.settlement-card-main').first().click();
await page.waitForSelector('.settlement-breakdown');
await page.evaluate(() => document.fonts.ready);
// The published images need real logos: fail rather than shoot the initials
// fallback CompanyLogo shows when Logo.dev is unreachable or the key is missing.
await page.waitForFunction(() => {
    const logos = [...document.querySelectorAll('.settlement-bill-logo')];
    return logos.length > 0 && logos.every((logo) => {
        const img = logo.matches('img') ? logo : logo.querySelector('img');
        return img && img.complete && img.naturalWidth > 0 && !img.classList.contains('company-logo-hidden');
    });
}, null, { timeout: 15000 }).catch(() => {
    throw new Error('bill logos did not all load (is VITE_LOGODEV_KEY in .env.local at build time?)');
});
// Park the pointer off the board so the clicked card drops its hover style.
await page.mouse.move(950, 1390);
await page.waitForTimeout(500);

// Hero: top of the page to 8 px below the second household card.
const second = await page.locator('.settlement-card').nth(1).boundingBox();
await page.screenshot({ path: path.join(out, 'hero.png'), clip: { x: 0, y: 0, width: 960, height: Math.ceil(second.y + second.height + 8) } });

// Household: the first card's breakdown, padded 16 px, ending 6 px below the
// "Total (Nathan Payne)" row.
const bd = page.locator('.settlement-card').first().locator('.settlement-breakdown').first();
const box = await bd.boundingBox();
const total = await bd.locator('.settlement-breakdown-total').boundingBox();
const pad = 16;
await page.screenshot({ path: path.join(out, 'household.png'), clip: { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: Math.ceil(total.y + total.height - box.y + pad + 6) } });

await browser.close();
console.log('Wrote hero.png and household.png to ' + out);
