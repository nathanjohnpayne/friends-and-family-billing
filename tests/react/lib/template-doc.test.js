import { describe, it, expect } from 'vitest';
import { plainTextToDoc, docToPlainTextWithTokens } from '../../../src/lib/template-doc.js';

/**
 * Link-target parsing. The regression these cover is CodeQL js/redos alert #1
 * on `applyLinks`: the target group used to be `(?:[^()]*|\([^()]*\))*`, whose
 * first alternative can match the empty string. That gives the engine
 * exponentially many ways to divide the same run of characters, so an
 * UNCLOSED target backtracks through all of them before failing.
 */

function firstLinkMark(doc) {
    for (const block of doc.content ?? []) {
        for (const node of block.content ?? []) {
            const link = (node.marks ?? []).find((m) => m.type === 'link');
            if (link) return { text: node.text, href: link.attrs.href };
        }
    }
    return null;
}

describe('plainTextToDoc link parsing', () => {
    it('parses a plain link', () => {
        expect(firstLinkMark(plainTextToDoc('see [the invoice](https://example.com/i/1)')))
            .toEqual({ text: 'the invoice', href: 'https://example.com/i/1' });
    });

    it('keeps one level of balanced parentheses in the target', () => {
        expect(firstLinkMark(plainTextToDoc('[ref](https://example.com/p_(v))')))
            .toEqual({ text: 'ref', href: 'https://example.com/p_(v)' });
    });

    it('accepts an empty target', () => {
        expect(firstLinkMark(plainTextToDoc('[nowhere]()')))
            .toEqual({ text: 'nowhere', href: '' });
    });

    it('leaves an unclosed target as plain text', () => {
        expect(firstLinkMark(plainTextToDoc('[nope](https://example.com'))).toBeNull();
    });

    it('round-trips a link through docToPlainTextWithTokens', () => {
        const source = 'pay [here](https://example.com/pay) today';
        expect(docToPlainTextWithTokens(plainTextToDoc(source))).toContain('[here](https://example.com/pay)');
    });

    /**
     * The guard. `%` repeated 28 times after an unclosed `(` is the shape CodeQL
     * named, and the length is chosen deliberately: the old pattern needs ~3.3s
     * for it and the current one ~0ms, so the budget below fails in seconds
     * rather than hanging the suite. Exponential growth makes the length the
     * whole story -- 30 characters already costs the old pattern ~13s and 2000
     * would never return -- so any regression trips this with a margin of
     * thousands, not percent.
     */
    it('parses an unclosed link target without exponential backtracking', () => {
        const pathological = `[x](${'%'.repeat(28)}`;
        const started = Date.now();
        const doc = plainTextToDoc(pathological);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(firstLinkMark(doc)).toBeNull();
    });
});
