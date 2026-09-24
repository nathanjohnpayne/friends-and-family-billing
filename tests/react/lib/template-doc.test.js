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
     * `[x]()` parses to a link mark with an empty href and does NOT survive a
     * round trip: `textFromInline` re-emits the `[text](href)` wrapper only when
     * `href` is truthy (src/lib/template-doc.js:57-58), so the next save writes
     * plain `nowhere`.
     *
     * Justification under docs/agents/operating-rules.md § Serialization layer
     * review requirement, which requires a lossy round trip to be justified or
     * eliminated:
     *
     * 1. Losslessness — what is discarded is a link mark carrying NO
     *    destination. It renders as `<a href="">`, which resolves to the
     *    current page, so it is not a link to anywhere. The semantically
     *    meaningful content, the anchor text, is preserved verbatim. Dropping
     *    an anchor that points nowhere loses no meaning a reader or renderer
     *    can act on.
     * 2. Consumer parity — there is exactly one parser (`plainTextToDoc`) and
     *    one serializer (`docToPlainTextWithTokens`) for this format, so there
     *    is no second implementation to diverge from.
     * 3. Necessity — the intermediate plain-text format is required, not
     *    incidental: templates are stored and hand-edited as text carrying
     *    `%token%` placeholders, so the conversion cannot simply be removed.
     *
     * The cleaner end state is for the parser to stop minting a
     * destination-less mark at all, which makes the round trip lossless rather
     * than justified — filed separately rather than folded into a security fix
     * to keep this PR's scope to the two CodeQL alerts.
     *
     * Pinned in both directions so the behaviour is asserted rather than
     * assumed. Codex P2 on PR #449, rounds 1 and 2.
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
