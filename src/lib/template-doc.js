/**
 * Template document conversion utilities.
 * Pure functions for converting between ProseMirror JSON documents
 * and plain text with %token% markers.
 *
 * Extracted from invoice.js to avoid pulling the heavy unified/remark
 * markdown pipeline into BillingYearService's import chain.
 */

/** Map legacy token IDs to normalized IDs. */
const LEGACY_TOKEN_IDS = {
    member_first: 'first_name',
    member_last: 'last_name',
    member_name: 'full_name',
    annual_total: 'household_total',
};

/**
 * Serialize a mark set to a string key for grouping adjacent nodes.
 * Marks are sorted by type so {bold, italic} === {italic, bold}.
 */
function markKey(marks) {
    if (!marks || marks.length === 0) return '';
    return marks
        .filter(m => m.type !== 'link')
        .map(m => m.type)
        .sort()
        .join('+');
}

/**
 * Wrap text in markdown mark syntax.
 * Bold must wrap before italic so ***text*** = bold(italic(text)).
 */
function wrapWithMarkdown(text, marks) {
    if (!marks || marks.length === 0) return text;
    let result = text;
    if (marks.some(m => m.type === 'italic')) result = '*' + result + '*';
    if (marks.some(m => m.type === 'bold')) result = '**' + result + '**';
    return result;
}

/**
 * Convert inline nodes to plain text, merging adjacent nodes with identical
 * mark sets before wrapping with markdown syntax. This prevents
 * **text1****text2** (which CommonMark renders as one bold span) when
 * TipTap splits text at internal boundaries.
 */
function textFromInline(nodes) {
    if (!nodes) return '';

    // Phase 1: serialize each node to its text representation (without mark wrappers)
    const segments = [];
    for (const n of nodes) {
        if (n.type === 'text') {
            let text = n.text || '';
            const linkMark = n.marks?.find(m => m.type === 'link');
            if (linkMark && linkMark.attrs?.href) {
                text = '[' + text + '](' + linkMark.attrs.href + ')';
            }
            segments.push({ text, marks: n.marks || [] });
        } else if (n.type === 'templateToken') {
            const rawId = n.attrs?.id || '';
            const id = LEGACY_TOKEN_IDS[rawId] || rawId;
            segments.push({ text: '%' + id + '%', marks: n.marks || [] });
        } else if (n.type === 'hardBreak') {
            segments.push({ text: '\n', marks: [] });
        }
    }

    // Phase 2: merge adjacent segments with the same non-link marks
    const merged = [];
    for (const seg of segments) {
        const key = markKey(seg.marks);
        const last = merged.length > 0 ? merged[merged.length - 1] : null;
        if (last && last.key === key) {
            last.text += seg.text;
        } else {
            merged.push({ text: seg.text, key, marks: seg.marks });
        }
    }

    // Phase 3: wrap each merged run with markdown marks
    return merged.map(s => wrapWithMarkdown(s.text, s.marks)).join('');
}

/**
 * Convert a ProseMirror JSON document to plain text with %token% markers.
 * @param {Object} doc — ProseMirror JSON document
 * @returns {string}
 */
export function docToPlainTextWithTokens(doc) {
    if (!doc || !doc.content) return '';
    const blocks = [];

    function walkBlock(node) {
        if (!node) return;
        switch (node.type) {
            case 'paragraph':
                blocks.push(textFromInline(node.content));
                break;
            case 'blockToken':
                blocks.push('%' + (node.attrs?.id || '') + '%');
                break;
            case 'bulletList':
            case 'orderedList': {
                const items = node.content || [];
                items.forEach((item, i) => {
                    const prefix = node.type === 'orderedList' ? (i + 1) + '. ' : '- ';
                    const itemText = (item.content || []).map(p => textFromInline(p.content)).join('\n');
                    blocks.push(prefix + itemText);
                });
                break;
            }
            case 'horizontalRule':
                blocks.push('---');
                break;
            case 'blockquote':
                (node.content || []).forEach(child => {
                    blocks.push('> ' + textFromInline(child.content));
                });
                break;
            default:
                if (node.content) node.content.forEach(walkBlock);
                break;
        }
    }

    doc.content.forEach(walkBlock);
    return blocks.join('\n');
}

/**
 * Convert a legacy plain-text template to ProseMirror JSON.
 * @param {string} text — legacy template text
 * @returns {Object} — ProseMirror JSON document
 */
export function plainTextToDoc(text) {
    if (!text) return { type: 'doc', content: [{ type: 'paragraph' }] };

    const tokenPattern = /\*\*\*%([a-z_]+)%\*\*\*|\*\*%([a-z_]+)%\*\*|\*%([a-z_]+)%\*|%([a-z_]+)%/g;
    const blockTokenIds = new Set(['payment_methods', 'share_link']);
    const tokenLabels = {
        first_name: 'First Name', last_name: 'Last Name', full_name: 'Full Name',
        billing_year: 'Billing Year', household_total: 'Household Total',
        payment_methods: 'Payment Methods', share_link: 'Share Link',
        member_first: 'First Name', member_last: 'Last Name',
        member_name: 'Full Name', annual_total: 'Household Total',
    };

    const lines = text.split('\n');
    const content = [];

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^---+$/.test(trimmed)) {
            content.push({ type: 'horizontalRule' });
            continue;
        }

        tokenPattern.lastIndex = 0;
        const soloMatch = trimmed.match(/^(?:\*\*%([a-z_]+)%\*\*|%([a-z_]+)%)$/);
        const soloId = soloMatch && (soloMatch[1] || soloMatch[2]);
        if (soloId && blockTokenIds.has(soloId)) {
            content.push({
                type: 'blockToken',
                attrs: {
                    id: soloId,
                    label: tokenLabels[soloId] || soloId,
                    description: soloId === 'payment_methods'
                        ? 'Expands into your configured payment options.'
                        : 'Expands into the member\u2019s share link.',
                },
            });
            continue;
        }

        if (trimmed === '') {
            content.push({ type: 'paragraph' });
            continue;
        }

        const rawNodes = [];
        let lastIdx = 0;
        tokenPattern.lastIndex = 0;
        let match;

        while ((match = tokenPattern.exec(line)) !== null) {
            const before = line.slice(lastIdx, match.index);
            if (before) rawNodes.push({ type: 'text', text: before });
            const tokenId = match[1] || match[2] || match[3] || match[4];
            if (tokenLabels[tokenId]) {
                const normalizedId = tokenId === 'member_first' ? 'first_name'
                    : tokenId === 'member_last' ? 'last_name'
                    : tokenId === 'member_name' ? 'full_name'
                    : tokenId === 'annual_total' ? 'household_total'
                    : tokenId;
                const tokenNode = {
                    type: 'templateToken',
                    attrs: { id: normalizedId, label: tokenLabels[tokenId] },
                };
                const marks = [];
                if (match[1] != null || match[2] != null) marks.push({ type: 'bold' });
                if (match[1] != null || match[3] != null) marks.push({ type: 'italic' });
                if (marks.length > 0) tokenNode.marks = marks;
                rawNodes.push(tokenNode);
            } else {
                rawNodes.push({ type: 'text', text: match[0] });
            }
            lastIdx = match.index + match[0].length;
        }
        const remaining = line.slice(lastIdx);
        if (remaining) rawNodes.push({ type: 'text', text: remaining });

        const nodes = parseInlineMarkdown(rawNodes);
        content.push({ type: 'paragraph', content: nodes.length > 0 ? nodes : undefined });
    }

    return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

// ── Inline markdown parsing helpers ─────────────────────────────────

function parseInlineMarkdown(nodes) {
    let result = splitByPattern(nodes, /\*\*\*(.+?)\*\*\*/g, (inner) => {
        const parsed = applyLinks([{ type: 'text', text: inner }]);
        return parsed.map(n => addMark(addMark(n, { type: 'italic' }), { type: 'bold' }));
    });
    result = splitByPattern(result, /\*\*(.+?)\*\*/g, (inner) => {
        const parsed = applyLinks([{ type: 'text', text: inner }]);
        return parsed.map(n => addMark(n, { type: 'bold' }));
    });
    result = applyItalic(result);
    result = applyLinks(result);
    return result;
}

function addMark(node, mark) {
    return { ...node, marks: [...(node.marks || []), mark] };
}

function splitByPattern(nodes, pattern, matchHandler) {
    const result = [];
    for (const node of nodes) {
        if (node.type !== 'text') { result.push(node); continue; }
        const text = node.text;
        const inheritedMarks = node.marks || [];
        let lastIdx = 0;
        let match;
        let matched = false;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
            matched = true;
            const before = text.slice(lastIdx, match.index);
            if (before) {
                const n = { type: 'text', text: before };
                if (inheritedMarks.length > 0) n.marks = [...inheritedMarks];
                result.push(n);
            }
            const produced = matchHandler(match[1], match);
            for (const p of produced) {
                if (inheritedMarks.length > 0) {
                    result.push({ ...p, marks: [...inheritedMarks, ...(p.marks || [])] });
                } else {
                    result.push(p);
                }
            }
            lastIdx = match.index + match[0].length;
        }
        if (!matched) {
            result.push(node);
        } else {
            const rem = text.slice(lastIdx);
            if (rem) {
                const n = { type: 'text', text: rem };
                if (inheritedMarks.length > 0) n.marks = [...inheritedMarks];
                result.push(n);
            }
        }
    }
    return result;
}

function applyItalic(nodes) {
    return splitByPattern(nodes, /\*(.+?)\*/g, (inner) => {
        return [{ type: 'text', text: inner, marks: [{ type: 'italic' }] }];
    });
}

function applyLinks(nodes) {
    const linkPattern = /\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)/g;
    return splitByPattern(nodes, linkPattern, (linkText, match) => {
        return [{
            type: 'text',
            text: linkText,
            marks: [{ type: 'link', attrs: { href: match[2], target: '_blank', rel: 'noopener noreferrer' } }],
        }];
    });
}
