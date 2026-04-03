/**
 * TokenNode — TipTap custom inline node for text-replacement tokens.
 * Renders as a non-editable pill in the editor; serializes to %token_id%
 * via renderText() for the plain-text pipeline.
 */
import { Node, mergeAttributes } from '@tiptap/core';

/** Inline tokens available in both body and subject editors. */
export const INLINE_TOKENS = [
    { id: 'first_name', label: 'First Name' },
    { id: 'last_name', label: 'Last Name' },
    { id: 'full_name', label: 'Full Name' },
    { id: 'billing_year', label: 'Billing Year' },
    { id: 'household_total', label: 'Household Total' },
];

const TokenNode = Node.create({
    name: 'templateToken',
    group: 'inline',
    inline: true,
    atom: true,
    marks: '_',

    addAttributes() {
        return {
            id: { default: null },
            label: { default: '' },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-token-id]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, {
            'data-token-id': node.attrs.id,
            class: 'template-editor-token',
            contenteditable: 'false',
        }), node.attrs.label];
    },

    renderText({ node }) {
        return '%' + node.attrs.id + '%';
    },
});

export default TokenNode;
