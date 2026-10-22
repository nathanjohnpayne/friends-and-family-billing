/**
 * Shared primitives in shell.css (#546): pill buttons, radii, shadows, filter
 * chips, inline alerts and toasts, per plans/ffb-wireframes.html § Visual
 * system. The checks read the stylesheet and resolve every token through
 * design-tokens.css, so a rule that drifts from the legend fails here before
 * it reaches a screen.
 *
 * The load-bearing rule: Ember (#ff692d) is 2.87:1 against white, so a
 * filled Ember button carries Ink text and never white. Every rule in
 * shell.css whose background resolves to Ember must set its text to Ink.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
    AA_TEXT, TOKENS_PATH, contrastRatio, parseColor, parseTokens, resolveToken
} from '../../scripts/contrast-ratios.mjs';

const ROOT = path.dirname(TOKENS_PATH);
const tokens = parseTokens(readFileSync(TOKENS_PATH, 'utf8'));
const shell = readFileSync(path.join(ROOT, 'src', 'app', 'shell.css'), 'utf8');

const EMBER = '#ff692d';
const INK = '#22201d';
const PAPER = '#ffffff';

/** Strip comments and split the stylesheet into { selector, declarations } rules. */
function parseRules(css) {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    // Flatten @media blocks: their inner rules are still rules for our purposes.
    const flat = noComments.replace(/@media[^{]+\{([\s\S]*?)\}\s*(?=\n\S|$)/g, (m, inner) => inner);
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim();
        if (!selector || selector.startsWith('@')) continue;
        const declarations = {};
        for (const decl of m[2].split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            declarations[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
        }
        rules.push({ selector, declarations });
    }
    return rules;
}

/** Resolve `var(--x, fallback)` chains and literal colours to a lowercase hex. */
function resolveValue(value) {
    if (!value) return null;
    const v = value.trim();
    const ref = v.match(/^var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)$/);
    if (ref) {
        if (ref[1] in tokens) return resolveValue(resolveToken(tokens, ref[1]));
        return ref[2] ? resolveValue(ref[2]) : null;
    }
    try {
        const c = parseColor(v);
        return c.a === 1 ? '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('') : null;
    } catch {
        return null;
    }
}

function background(decls) {
    return resolveValue(decls['background-color'] || decls['background']);
}

const rules = parseRules(shell);
const find = (selector) => rules.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
const decls = (selector) => Object.assign({}, ...find(selector).map((r) => r.declarations));

describe('primary button: Ember fill, Ink text', () => {
    it('fills .btn-primary with Ember and sets Ink text', () => {
        const d = decls('.btn-primary');
        expect(background(d)).toBe(EMBER);
        expect(resolveValue(d.color)).toBe(INK);
    });

    it('never puts white text on an Ember background anywhere in shell.css', () => {
        const emberFills = rules.filter((r) => background(r.declarations) === EMBER);
        expect(emberFills.length, 'expected at least the primary button to fill Ember').toBeGreaterThan(0);
        for (const r of emberFills) {
            const color = resolveValue(r.declarations.color);
            expect(color, `${r.selector} fills Ember and must declare Ink text`).toBe(INK);
            expect(contrastRatio(parseColor(color), parseColor(EMBER))).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it('keeps Ink text on the hover fill too', () => {
        const d = decls('.btn-primary:hover:not(:disabled)');
        const bg = background(d);
        expect(bg).toBeTruthy();
        expect(contrastRatio(parseColor(INK), parseColor(bg))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(resolveValue(d.color) ?? INK).toBe(INK);
    });

    it('has no white-on-Ember inline styles under src/app either', () => {
        // The legend's one forbidden pairing, written as a literal or via the accent token.
        const offenders = [];
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (/\.jsx?$/.test(entry.name)) {
                    const src = readFileSync(full, 'utf8');
                    if (/background:\s*'var\(--color-(accent|ember)\)'[^}]*color:\s*'(#fff(fff)?|white|var\(--color-text-inverse\))'/i.test(src)) offenders.push(full);
                }
            }
        };
        walk(path.join(ROOT, 'src', 'app'));
        expect(offenders).toEqual([]);
    });
});

describe('button shapes', () => {
    it('renders every .btn as a pill with a hairline and Ink text by default', () => {
        const d = decls('.btn');
        expect(d['border-radius']).toMatch(/radius-(button|pill)/);
        expect(resolveToken(tokens, '--radius-button')).toBe('9999px');
        expect(resolveValue(d.color)).toBe(INK);
        expect(background(d)).toBe(PAPER);
    });

    it('styles secondary as Paper + Stone hairline and tertiary as a ghost', () => {
        const secondary = decls('.btn-secondary');
        expect(background(secondary)).toBe(PAPER);
        expect(resolveValue(secondary['border-color'])).toBe(resolveToken(tokens, '--color-stone'));
        const tertiary = decls('.btn-tertiary');
        expect(tertiary.background).toBe('transparent');
        expect(tertiary['border-color']).toBe('transparent');
        expect(resolveValue(tertiary.color)).toBe(resolveToken(tokens, '--color-graphite-text'));
    });

    it('keeps the destructive fill at AA with white text', () => {
        const d = decls('.btn-destructive');
        expect(contrastRatio(parseColor(resolveValue(d.color)), parseColor(background(d)))).toBeGreaterThanOrEqual(AA_TEXT);
    });
});

describe('radii and shadows', () => {
    it('defines the semantic radius tokens the legend implies', () => {
        expect(resolveToken(tokens, '--radius-card')).toBe('12px');
        expect(resolveToken(tokens, '--radius-input')).toBe('8px');
        expect(resolveToken(tokens, '--radius-alert')).toBe('8px');
        expect(resolveToken(tokens, '--radius-button')).toBe('9999px');
    });

    it('rounds cards to 12 px and inputs to 8 px through the tokens', () => {
        for (const card of ['.empty-state', '.member-card', '.bill-card', '.settlement-card', '.dispute-card', '.refund-notice-card', '.share-bill-card']) {
            expect(decls(card)['border-radius'], card).toMatch(/--radius-card/);
        }
        for (const input of ['.composer-input', '.inline-edit-input']) {
            expect(decls(input)['border-radius'], input).toMatch(/--radius-input/);
        }
        for (const alert of ['.inline-alert', '.status-banner', '.composer-error']) {
            expect(decls(alert)['border-radius'], alert).toMatch(/--radius-alert/);
        }
    });

    it('keeps shadows whisper-light and Ink-tinted (no pure-black shadows)', () => {
        const shadows = [...shell.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]);
        expect(shadows.length).toBeGreaterThan(0);
        for (const s of shadows) {
            expect(s, s).not.toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0/);
        }
        const card = resolveToken(tokens, '--shadow-card');
        const alpha = Number(card.match(/rgba\([^)]*,\s*([\d.]+)\)/)[1]);
        expect(alpha).toBeLessThanOrEqual(0.05);
        for (const name of ['--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-dialog', '--shadow-dropdown', '--shadow-toast', '--shadow-menu']) {
            expect(resolveToken(tokens, name), name).toMatch(/rgba\(34, 32, 29,/);
        }
    });
});

describe('filter chips', () => {
    it('selects a chip with an Ink fill and Paper text, and keeps the count readable', () => {
        for (const sel of ['.settlement-filter-chip.active', '.dispute-filter-btn.active', '.filter-chip.active']) {
            const d = decls(sel);
            expect(background(d), sel).toBe(INK);
            expect(resolveValue(d.color), sel).toBe(PAPER);
        }
        const count = decls('.settlement-filter-chip.active .settlement-filter-count');
        expect(contrastRatio(parseColor(resolveValue(count.color)), parseColor(INK))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('draws an unselected chip as a Paper pill with a Stone hairline', () => {
        const d = decls('.settlement-filter-chip');
        expect(d['border-radius']).toMatch(/--radius-pill/);
        expect(background(d)).toBe(PAPER);
        expect(resolveValue(d['border-color'] || d.border?.split(/\s+/).pop())).toBe(resolveToken(tokens, '--color-stone'));
    });
});

describe('inline alerts and toasts', () => {
    it('pairs every alert variant text with its tint at AA', () => {
        for (const variant of ['--error', '--success', '--warning', '--info']) {
            const d = decls(`.inline-alert${variant}`);
            const fg = resolveValue(d.color);
            const bg = background(d);
            expect(fg, variant).toBeTruthy();
            expect(bg, variant).toBeTruthy();
            expect(contrastRatio(parseColor(fg), parseColor(bg)), variant).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it('maps the legacy error and warning classes onto the alert variants', () => {
        expect(background(decls('.composer-error'))).toBe(resolveToken(tokens, '--color-status-outstanding-bg'));
        expect(background(decls('.status-banner--warning'))).toBe(resolveToken(tokens, '--color-status-warning-bg'));
    });

    it('shapes toasts as Ink pills and keeps the failure variant readable', () => {
        const toast = decls('.change-toast');
        expect(toast['border-radius']).toMatch(/--radius-pill/);
        expect(background(toast)).toBe(INK);
        expect(resolveValue(toast.color)).toBe(PAPER);
        const failure = decls('.change-toast--failure');
        expect(background(failure)).toBe(resolveToken(tokens, '--color-status-outstanding-fg'));
        expect(contrastRatio(parseColor(PAPER), parseColor(background(failure)))).toBeGreaterThanOrEqual(AA_TEXT);
        const refresh = decls('.update-toast-btn');
        expect(background(refresh)).toBe(EMBER);
        expect(resolveValue(refresh.color)).toBe(INK);
    });
});
