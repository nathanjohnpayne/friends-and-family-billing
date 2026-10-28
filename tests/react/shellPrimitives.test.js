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

    it('applies the card shadow to every card primitive', () => {
        for (const card of ['.member-card', '.bill-card', '.settlement-card', '.dispute-card', '.refund-notice-card', '.share-bill-card', '.dashboard-hero']) {
            expect(decls(card)['box-shadow'], card).toMatch(/--shadow-card/);
        }
    });

    it('keeps a visible keyboard focus ring on action menu items', () => {
        const focused = decls('.action-menu-item:focus-visible');
        expect(focused['box-shadow']).toMatch(/inset 0 0 0 2px var\(--color-text\)/);
        const danger = decls('.action-menu-item--danger:focus-visible');
        expect(danger['box-shadow']).toMatch(/inset 0 0 0 2px var\(--color-danger\)/);
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

describe('progress bar (#570)', () => {
    it('keeps the fill at least 3:1 against its track and the card behind it', () => {
        for (const [fillSel, trackSel] of [['.progress-fill', '.progress-track'], ['.share-progress-bar', '.share-progress']]) {
            const fill = background(decls(fillSel));
            const track = background(decls(trackSel));
            expect(fill, fillSel).toBeTruthy();
            expect(track, trackSel).toBeTruthy();
            expect(contrastRatio(parseColor(fill), parseColor(track)), `${fillSel} on ${trackSel}`).toBeGreaterThanOrEqual(3);
            expect(contrastRatio(parseColor(fill), parseColor(PAPER)), `${fillSel} on Paper`).toBeGreaterThanOrEqual(3);
        }
    });
});

describe('dialog evidence and audit rows (#575 F04)', () => {
    it('draws evidence and audit-history rows as Paper-tint insets with a Stone hairline, not Linen', () => {
        for (const selector of ['.evidence-item', '.audit-event-item']) {
            const d = decls(selector);
            expect(background(d), selector).toBe(resolveToken(tokens, '--color-paper-tint'));
            expect(background(d), selector).not.toBe(resolveToken(tokens, '--color-linen'));
            expect(resolveValue(d.border?.split(/\s+/).pop()), selector).toBe(resolveToken(tokens, '--color-stone'));
        }
    });

    it('keeps the muted and destructive text on those rows at AA', () => {
        const bg = parseColor(resolveToken(tokens, '--color-paper-tint'));
        for (const sel of ['.evidence-size', '.audit-event-date', '.audit-event-note']) {
            const fg = resolveValue(decls(sel).color);
            expect(fg, sel).toBeTruthy();
            expect(contrastRatio(parseColor(fg), bg), sel).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(contrastRatio(parseColor(resolveToken(tokens, '--color-danger')), bg)).toBeGreaterThanOrEqual(AA_TEXT);
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

describe('payment-method switch (#575 F14)', () => {
    const track = '.payment-method-toggle input[type="checkbox"]';
    const STONE = resolveToken(tokens, '--color-stone');
    const SETTLED = resolveToken(tokens, '--color-status-settled-fg');

    it('draws the native checkbox as a 30 x 18 pill track with a white knob', () => {
        const d = decls(track);
        expect(d.appearance).toBe('none');
        expect(d.width).toBe('30px');
        expect(d.height).toBe('18px');
        expect(resolveValue(d.background)).toBe(STONE);
        expect(resolveValue(decls(`${track}::after`).background)).toBe(PAPER);
    });

    it('turns Settled green when on', () => {
        expect(resolveValue(decls(`${track}:checked`).background)).toBe(SETTLED);
    });

    it('keeps the track and knob at 3:1 against what they sit on', () => {
        const outline = resolveValue(decls(track).border.split(/\s+/).pop());
        expect(contrastRatio(parseColor(outline), parseColor(PAPER)), 'off outline on Paper').toBeGreaterThanOrEqual(3);
        expect(contrastRatio(parseColor(SETTLED), parseColor(PAPER)), 'on track on Paper').toBeGreaterThanOrEqual(3);
        expect(contrastRatio(parseColor(PAPER), parseColor(SETTLED)), 'knob on on-track').toBeGreaterThanOrEqual(3);
    });

    it('shows a keyboard focus ring', () => {
        const d = decls(`${track}:focus-visible`);
        expect(d.outline).toMatch(/2px solid var\(--color-ink\)/);
    });
});

describe('display dialog titles (#575 F07)', () => {
    it('restates the display weight over .dialog-title so Fraunces is not faux-bolded', () => {
        const d = decls('.dialog-title.type-display');
        expect(d['font-weight']).toMatch(/--font-weight-display/);
        expect(resolveToken(tokens, '--font-weight-display')).toBe('300');
    });
});
