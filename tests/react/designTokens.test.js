/**
 * design-tokens.css — the colour foundation from plans/ffb-wireframes.html § Visual
 * system (#544). Guards three things a token edit can silently break: a legend
 * colour going missing, a `var()` chain that no longer resolves, and a
 * text/background pair dropping below WCAG AA.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
    AA_NON_TEXT, AA_TEXT, PAIRS, TOKENS_PATH,
    contrastRatio, evaluate, parseColor, parseTokens, resolveToken
} from '../../scripts/contrast-ratios.mjs';

const css = readFileSync(TOKENS_PATH, 'utf8');
const tokens = parseTokens(css);

/** Name → hex, exactly as the wireframe legend lists them. */
const LEGEND = {
    '--color-linen': '#efecea',
    '--color-paper': '#ffffff',
    '--color-ink': '#22201d',
    '--color-graphite-text': '#66645f',
    '--color-graphite': '#777573',
    '--color-placeholder': '#6f6d69',
    '--color-stone': '#dcd9d6',
    '--color-ember': '#ff692d',
    '--color-ember-text': '#ad3c0b',
    '--color-ember-tint': '#ffe0d3',
    '--color-status-settled-fg': '#1e6b3f',
    '--color-status-settled-bg': '#e1f0e5',
    '--color-status-partial-fg': '#2f5b9c',
    '--color-status-partial-bg': '#e3ebf7',
    '--color-status-outstanding-fg': '#9b2335',
    '--color-status-outstanding-bg': '#f9e3e6',
    '--color-status-review-fg': '#6b3fa0',
    '--color-status-review-bg': '#ece4f6',
    '--color-status-credit-fg': '#0f6e73',
    '--color-status-credit-bg': '#dcf0ef',
    '--color-status-warning-fg': '#8a5a00',
    '--color-status-warning-bg': '#fbf1dc'
};

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(css|jsx?)$/.test(entry)) out.push(full);
    }
    return out;
}

describe('design-tokens.css colour foundation', () => {
    it('defines every colour in the wireframe legend under its documented name', () => {
        for (const [name, hex] of Object.entries(LEGEND)) {
            expect(tokens[name], name).toBe(hex);
        }
    });

    it('resolves every var() reference inside design-tokens.css', () => {
        for (const name of Object.keys(tokens)) {
            expect(() => resolveToken(tokens, name), name).not.toThrow();
        }
    });

    it('defines every colour token that src/app consumes', () => {
        const consumed = new Set();
        for (const file of walk(path.resolve(path.dirname(TOKENS_PATH), 'src', 'app'))) {
            for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\((--(?:color|toast)-[a-z0-9-]+)/g)) consumed.add(name);
        }
        expect(consumed.size).toBeGreaterThan(0);
        const missing = [...consumed].filter((name) => !(name in tokens)).sort();
        expect(missing).toEqual([]);
    });

    it('keeps every text pair in use at or above WCAG AA', () => {
        const rows = evaluate(tokens);
        expect(rows.length).toBe(PAIRS.length);
        const failures = rows
            .filter((r) => r.pass === false)
            .map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1 < ${r.min}:1`);
        expect(failures).toEqual([]);
        expect(rows.filter((r) => r.min === AA_TEXT).length).toBeGreaterThan(20);
        expect(rows.filter((r) => r.min === AA_NON_TEXT).length).toBeGreaterThan(0);
    });

    it('computes WCAG ratios the way the wireframe legend does', () => {
        // Figures quoted in plans/ffb-wireframes.html § Visual system.
        const ember = parseColor('#ff692d');
        const ink = parseColor('#22201d');
        const white = parseColor('#ffffff');
        expect(contrastRatio(ember, white)).toBeCloseTo(2.87, 2);
        expect(contrastRatio(ink, ember)).toBeCloseTo(5.66, 2);
        expect(contrastRatio(parseColor('#777573'), parseColor('#efecea'))).toBeCloseTo(3.9, 2);
    });
});
