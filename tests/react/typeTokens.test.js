/**
 * Type foundation (#545): Fraunces and Inter are self-hosted and exposed as
 * tokens. These checks read the source files directly so a reintroduced
 * third-party font `<link>` or a renamed token fails fast.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('type tokens', () => {
    const tokens = read('design-tokens.css');

    it('defines the display and UI family tokens', () => {
        expect(tokens).toMatch(/--font-family-display:\s*'Fraunces'/);
        expect(tokens).toMatch(/--font-family-ui:\s*'Inter'/);
        expect(tokens).toMatch(/--font-family:\s*var\(--font-family-ui\)/);
    });

    it('defines the display weight, tracking and line-height tokens', () => {
        expect(tokens).toMatch(/--font-weight-display:\s*300;/);
        expect(tokens).toMatch(/--tracking-display:\s*-0\.02em;/);
        expect(tokens).toMatch(/--tracking-tight:\s*-0\.01em;/);
        expect(tokens).toMatch(/--tracking-eyebrow:\s*0\.1em;/);
        expect(tokens).toMatch(/--line-height-display:\s*1\.1;/);
    });

    it('applies the UI family at the root and offers the display helper', () => {
        const shell = read('src/app/shell.css');
        expect(shell).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-family-ui/);
        expect(shell).toMatch(/\.type-display\s*{[^}]*var\(--font-family-display/);
    });
});

describe('self-hosted fonts', () => {
    it('registers Fraunces 300 and the Inter UI weights from @fontsource', () => {
        const main = read('src/app/main.jsx');
        expect(main).toContain("import '@fontsource/fraunces/latin-300.css'");
        for (const weight of [400, 500, 600, 700]) {
            expect(main).toContain(`import '@fontsource/inter/latin-${weight}.css'`);
        }
    });

    it('serves the content-hashed font files with a long-lived immutable cache header (#575)', () => {
        const hosting = JSON.parse(read('firebase.json')).hosting;
        const fonts = hosting.headers.find((h) => h.source === '**/*.woff2');
        expect(fonts, 'a **/*.woff2 header rule in firebase.json').toBeDefined();
        const cache = fonts.headers.find((h) => h.key === 'Cache-Control');
        expect(cache.value).toMatch(/max-age=31536000/);
        expect(cache.value).toMatch(/immutable/);
    });

    it('never references a third-party font host from the entry or stylesheets', () => {
        for (const file of ['index.html', 'design-tokens.css', 'src/app/shell.css', 'vite.config.js', 'firebase.json']) {
            expect(read(file), file).not.toMatch(/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/);
        }
    });
});
