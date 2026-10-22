/**
 * The FFB brand mark (#548): an Ember tile carrying an Ink receipt glyph, per
 * plans/ffb-wireframes.html § Visual system. The mark lives in three places:
 * the in-app copy in NavBar.jsx (coloured through shell.css from the tokens)
 * and the standalone logo.svg / favicon.svg (literal legend hex, since a file
 * served on its own cannot read design-tokens.css). This pins the three to the
 * legend and to each other so a later recolour cannot drift one of them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOKENS_PATH, parseTokens } from '../../scripts/contrast-ratios.mjs';

const ROOT = path.dirname(TOKENS_PATH);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const tokens = parseTokens(read('design-tokens.css'));
const EMBER = tokens['--color-ember'];
const INK = tokens['--color-ink'];

/** Just the brand <svg> from NavBar.jsx; the user-menu icons follow it. */
const navBar = read('src/app/components/NavBar.jsx').match(/<svg className="nav-brand-icon"[\s\S]*?<\/svg>/)[0];
const shell = read('src/app/shell.css');
const standalone = { 'logo.svg': read('logo.svg'), 'favicon.svg': read('favicon.svg') };

/** The `d` attributes of every <path> in an SVG/JSX source, in document order. */
const glyphPaths = (src) => [...src.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);

/** Attribute value on the first element matching `tag` (e.g. the tile <rect>). */
const attr = (src, tag, name) => src.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`))?.[1];

describe('brand mark (Ember tile, Ink glyph)', () => {
    it('legend tokens the mark depends on exist', () => {
        expect(EMBER).toBe('#ff692d');
        expect(INK).toBe('#22201d');
    });

    it('NavBar colours the mark from the tokens, not a gradient or a literal', () => {
        expect(navBar).not.toMatch(/linearGradient|color-gradient-|#fff\b|rgba\(255/);
        expect(attr(navBar, 'rect', 'className')).toBe('nav-brand-tile');
        const classes = [...navBar.matchAll(/<path className="([^"]+)"/g)].map((m) => m[1]);
        expect(classes).toEqual(['nav-brand-glyph', 'nav-brand-glyph nav-brand-glyph-detail']);

        const rule = (selector) => shell.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
        expect(rule('.nav-brand-tile')).toMatch(/fill:\s*var\(--color-ember\)/);
        expect(rule('.nav-brand-glyph')).toMatch(/fill:\s*var\(--color-ink\)/);
        expect(rule('.nav-brand-glyph-detail')).toMatch(/opacity:\s*0?\.6/);
    });

    for (const [file, src] of Object.entries(standalone)) {
        it(`${file} carries the legend hex literally and says why`, () => {
            expect(src).not.toMatch(/linearGradient|#fff\b|rgba\(255/);
            expect(attr(src, 'rect', 'fill')).toBe(EMBER);
            const fills = [...src.matchAll(/<path[^>]*\sfill="([^"]+)"/g)].map((m) => m[1]);
            expect(fills).toEqual([INK, INK]);
            expect(src).toMatch(/opacity="0?\.6"/);
            // The comment names the tokens so the next palette change finds this copy.
            expect(src).toMatch(/color-ember token/);
            expect(src).toMatch(/color-ink token/);
        });

        it(`${file} is well-formed XML (no "--" inside its comment)`, () => {
            // A standalone SVG goes through the browser's strict XML parser, which
            // rejects "--" inside a comment; jsdom's parser reports that the same
            // way, as a <parsererror> document instead of an <svg> root.
            const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
            expect(doc.querySelector('parsererror')).toBeNull();
            expect(doc.documentElement.tagName).toBe('svg');
            for (const [, comment] of src.matchAll(/<!--([\s\S]*?)-->/g)) expect(comment).not.toMatch(/--/);
        });
    }

    it('the three copies draw the same receipt glyph on the same tile', () => {
        const nav = glyphPaths(navBar);
        expect(nav).toHaveLength(2);
        for (const src of Object.values(standalone)) {
            expect(glyphPaths(src)).toEqual(nav);
            expect(attr(src, 'rect', 'rx')).toBe(attr(navBar, 'rect', 'rx'));
            expect(attr(src, 'svg', 'viewBox')).toBe(attr(navBar, 'svg', 'viewBox'));
        }
    });
});
