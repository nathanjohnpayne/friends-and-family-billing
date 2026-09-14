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

    /**
     * `[x]()` parses to a link mark with an empty href, and does NOT survive a
     * round trip: `textFromInline` only re-emits the `[text](href)` wrapper when
     * `href` is truthy (src/lib/template-doc.js:57-58), so the next save writes
     * plain `nowhere` and the link is gone. That asymmetry predates this file and
     * is untouched by the ReDoS fix — both the old and new patterns parse
     * `[nowhere]()` identically — but the parity case would otherwise read as an
     * endorsement of a syntax the module silently drops. Pinned in both
     * directions so the lossy half is a stated fact rather than a surprise; see
     * Codex P2 on PR #449.
     */
    it('parses an empty target but does not round-trip it', () => {
        const doc = plainTextToDoc('[nowhere]()');
        expect(firstLinkMark(doc)).toEqual({ text: 'nowhere', href: '' });
        expect(docToPlainTextWithTokens(doc)).toBe('nowhere');
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
