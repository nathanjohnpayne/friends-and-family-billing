#!/usr/bin/env node
/**
 * contrast-ratios.mjs — WCAG 2.x contrast ratios for the colour-token pairs
 * the app puts text on (#544).
 *
 * Reads design-tokens.css, resolves every `var(--x)` chain to a literal colour,
 * composites translucent backgrounds onto the surface beneath them, and prints a
 * Markdown table of the pairs listed in PAIRS. Exits 1 when any pair misses its
 * target (4.5:1 for text, 3:1 for non-text glyphs), so the table a PR quotes is
 * also a check.
 *
 *   node scripts/contrast-ratios.mjs            # table + pass/fail
 *   node scripts/contrast-ratios.mjs --json     # rows as JSON
 *
 * tests/react/designTokens.test.js imports the same functions, so the suite
 * fails locally the moment a token edit drops a text pair below AA.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKENS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'design-tokens.css');

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

/**
 * Every text/background pairing that shell.css, TemplateEditor.css or an inline
 * style under src/app/ produces, named by the tokens the stylesheet uses. `over`
 * is the opaque surface a translucent background sits on. `min` is the WCAG
 * target; `null` rows are fills with no text target and print for information.
 */
export const PAIRS = [
    // Body text
    { fg: '--color-text', bg: '--color-surface', use: 'Ink text on Paper (cards, dialogs, inputs)', min: AA_TEXT },
    { fg: '--color-text', bg: '--color-canvas', use: 'Ink text on Linen (page canvas)', min: AA_TEXT },
    { fg: '--color-text', bg: '--color-surface-inset', use: 'Ink text on the segmented-control track', min: AA_TEXT },
    { fg: '--color-text', bg: '--color-primary-light', use: 'Ink text on Ember tint', min: AA_TEXT },
    { fg: '--color-text', bg: '--color-accent', use: 'Ink text on Ember (primary button, #546)', min: AA_TEXT },
    // Muted text
    { fg: '--color-text-secondary', bg: '--color-surface', use: 'Graphite text on Paper (labels, hints, metadata)', min: AA_TEXT },
    { fg: '--color-text-secondary', bg: '--color-canvas', use: 'Graphite text on Linen', min: AA_TEXT },
    { fg: '--color-text-secondary', bg: '--color-surface-inset', use: 'Graphite text on the segmented-control track', min: AA_TEXT },
    { fg: '--color-text-secondary', bg: '--color-ember-wash', over: '--color-surface', use: 'Graphite text on an Ember wash (template hints)', min: AA_TEXT },
    { fg: '--color-text-placeholder', bg: '--color-surface', use: 'Placeholder text on Paper (inputs)', min: AA_TEXT },
    // Accent text
    { fg: '--color-primary', bg: '--color-surface', use: 'Ember text on Paper (links, active nav, token chips)', min: AA_TEXT },
    { fg: '--color-primary', bg: '--color-canvas', use: 'Ember text on Linen', min: AA_TEXT },
    { fg: '--color-primary', bg: '--color-primary-light', use: 'Ember text on Ember tint (pills, year pill)', min: AA_TEXT },
    { fg: '--color-primary', bg: '--color-ember-wash', over: '--color-surface', use: 'Ember text on an Ember wash (token chips)', min: AA_TEXT },
    { fg: '--color-primary', bg: '--color-ember-wash-strong', over: '--color-surface', use: 'Ember text on a strong Ember wash (hovered chips)', min: AA_TEXT },
    { fg: '--color-primary-hover', bg: '--color-surface', use: 'Ember text hover on Paper', min: AA_TEXT },
    { fg: '--color-primary-hover', bg: '--color-surface-alt', use: 'Ember text hover on Linen (tertiary button hover)', min: AA_TEXT },
    // Fills with text on them (#546): the primary pill is Ink on Ember, never white
    { fg: '--color-text', bg: '--color-accent-hover', use: 'Ink text on the Ember hover fill (primary button, hover)', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-ink', use: 'White text on Ink (selected filter chip, segment, .btn-ink, toast)', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-secondary-hover', use: 'White text on the Ink button hover fill', min: AA_TEXT },
    { fg: '--color-stone', bg: '--color-ink', use: 'Stone count inside a selected filter chip', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-primary', use: 'White text on the Ember-text fill (LoginView inline button, until RD-17)', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-primary-hover', use: 'White text on the Ember-text hover fill', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-danger', use: 'White text on the destructive fill', min: AA_TEXT },
    { fg: '--color-text-inverse', bg: '--color-danger-hover', use: 'White text on the destructive hover fill', min: AA_TEXT },
    { fg: '--toast-text', bg: '--toast-bg', use: 'Toast text on Ink', min: AA_TEXT },
    { fg: '--toast-dismiss', bg: '--toast-bg', use: 'Toast dismiss glyph on Ink', min: AA_TEXT },
    { fg: '--toast-text', bg: '--color-status-outstanding-fg', use: 'Failure toast text on the Outstanding fill (RD-23)', min: AA_TEXT },
    { fg: '--toast-dismiss', bg: '--color-status-outstanding-fg', use: 'Failure toast dismiss glyph on the Outstanding fill', min: AA_TEXT },
    // Status text on its border colour is never set; borders are hairlines. Inline
    // alerts put the status fg on its tint (the status rows below).
    // Status palette: each fg on its tint, on Paper and on Linen
    ...['settled', 'partial', 'outstanding', 'review', 'credit', 'warning'].flatMap((s) => [
        { fg: `--color-status-${s}-fg`, bg: `--color-status-${s}-bg`, use: `${s} on its tint (badges, alerts)`, min: AA_TEXT },
        { fg: `--color-status-${s}-fg`, bg: '--color-surface', use: `${s} on Paper (figures, borders-as-text)`, min: AA_TEXT },
        { fg: `--color-status-${s}-fg`, bg: '--color-canvas', use: `${s} on Linen`, min: AA_TEXT }
    ]),
    { fg: '--color-status-neutral-fg', bg: '--color-status-neutral-bg', use: 'neutral status on Linen', min: AA_TEXT },
    // Paper-tint inset panels inside a Paper card (#575): the expanded household
    // breakdown and the board's figure boxes, which carry Ink, muted and Ember
    // text and the Settled / Outstanding / Credit / Partial figures
    { fg: '--color-text', bg: '--color-surface-dim', use: 'Ink text on a Paper-tint panel (household breakdown)', min: AA_TEXT },
    { fg: '--color-text-secondary', bg: '--color-surface-dim', use: 'Graphite text on a Paper-tint panel (figure labels)', min: AA_TEXT },
    { fg: '--color-primary', bg: '--color-surface-dim', use: 'Ember text on a Paper-tint panel (Details toggle on hover)', min: AA_TEXT },
    ...['settled', 'partial', 'outstanding', 'credit'].map((s) => (
        { fg: `--color-status-${s}-fg`, bg: '--color-surface-dim', use: `${s} figure on a Paper-tint panel`, min: AA_TEXT }
    )),
    { fg: '--color-status-settled-hover', bg: '--color-surface', use: 'settled hover on Paper', min: AA_TEXT },
    // Non-text glyphs and graphical objects (WCAG 1.4.11, 3:1)
    { fg: '--color-icon', bg: '--color-surface', use: 'Graphite icons on Paper (non-text)', min: AA_NON_TEXT },
    { fg: '--color-icon', bg: '--color-canvas', use: 'Graphite icons on Linen (non-text)', min: AA_NON_TEXT },
    { fg: '--color-progress-fill', bg: '--color-progress-track', use: 'Progress fill on its track (dashboard, #570)', min: AA_NON_TEXT },
    { fg: '--color-progress-fill', bg: '--color-surface', use: 'Progress fill against the Paper card it sits in', min: AA_NON_TEXT },
    { fg: '--color-progress-fill-done', bg: '--color-progress-track', use: 'Finished progress fill on its track (share page, 100%)', min: AA_NON_TEXT },
    // Fills, for information only: the legend keeps Ember off small text for this reason
    { fg: '--color-accent', bg: '--color-surface', use: 'Ember fill on Paper (brand mark; never text)', min: null }
];

export function parseTokens(css) {
    const tokens = {};
    for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
    return tokens;
}

export function resolveToken(tokens, name, depth = 0) {
    if (!(name in tokens)) throw new Error(`token ${name} is not defined in design-tokens.css`);
    if (depth > 32) throw new Error(`token ${name} references itself`);
    const value = tokens[name];
    const ref = value.match(/^var\((--[a-z0-9-]+)\)$/);
    return ref ? resolveToken(tokens, ref[1], depth + 1) : value;
}

export function parseColor(value) {
    const v = value.trim().toLowerCase();
    let m = v.match(/^#([0-9a-f]{3,4})$/);
    if (m) {
        const d = m[1].split('').map((c) => parseInt(c + c, 16));
        return { r: d[0], g: d[1], b: d[2], a: d.length === 4 ? d[3] / 255 : 1 };
    }
    m = v.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
        const n = m[1];
        return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), a: n.length === 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1 };
    }
    m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    throw new Error(`cannot parse colour "${value}"`);
}

/** Source-over compositing of a translucent colour onto an opaque one. */
export function composite(top, under) {
    const a = top.a;
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

export function luminance({ r, g, b }) {
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg, bg) {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

export function evaluate(tokens, pairs = PAIRS) {
    return pairs.map((p) => {
        let bg = parseColor(resolveToken(tokens, p.bg));
        if (bg.a < 1) {
            if (!p.over) throw new Error(`${p.bg} is translucent; the pair needs an \`over\` surface`);
            bg = composite(bg, parseColor(resolveToken(tokens, p.over)));
        }
        const fg = parseColor(resolveToken(tokens, p.fg));
        const ratio = contrastRatio(fg, bg);
        return { ...p, fgHex: hex(fg), bgHex: hex(bg), ratio, pass: p.min === null ? null : ratio >= p.min };
    });
}

export function renderTable(rows) {
    const lines = ['| Foreground | Background | Ratio | Target | Use |', '|---|---|---|---|---|'];
    for (const r of rows) {
        const target = r.min === null ? 'none (fill)' : `${r.min}:1 ${r.pass ? 'pass' : 'FAIL'}`;
        lines.push(`| \`${r.fg}\` ${r.fgHex} | \`${r.bg}\` ${r.bgHex} | ${r.ratio.toFixed(2)}:1 | ${target} | ${r.use} |`);
    }
    return lines.join('\n');
}

function main() {
    const rows = evaluate(parseTokens(readFileSync(TOKENS_PATH, 'utf8')));
    if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else console.log(renderTable(rows));
    const failed = rows.filter((r) => r.pass === false);
    if (failed.length) {
        console.error(`\n${failed.length} pair(s) below target: ${failed.map((r) => `${r.fg} on ${r.bg}`).join(', ')}`);
        process.exit(1);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
