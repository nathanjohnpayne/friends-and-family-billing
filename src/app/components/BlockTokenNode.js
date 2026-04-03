/**
 * BlockTokenNode — TipTap custom block node for structured tokens
 * (%payment_methods%, %share_link%). Renders as a distinct card in the
 * editor via a React node view; serializes to %token_id% via renderText().
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import BlockTokenNodeView from './BlockTokenNodeView.jsx';

/** Block-level tokens (not allowed in the subject editor). */
export const BLOCK_TOKENS = [
    { id: 'payment_methods', label: 'Payment Methods', description: 'Expands into your configured payment options.' },
    { id: 'share_link', label: 'Share Link', description: 'Expands into the member\u2019s share link.' },
];

const BlockTokenNode = Node.create({
    name: 'blockToken',
    group: 'block',
    atom: true,

    addOptions() {
        return {
            onConfigurePaymentMethods: null,
        };
    },

    addAttributes() {
        return {
            id: { default: null },
            label: { default: '' },
            description: { default: '' },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-block-token]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-block-token': node.attrs.id,
            class: 'block-token-node',
        }), node.attrs.label];
    },

    renderText({ node }) {
        return '\n%' + node.attrs.id + '%\n';
    },

    addNodeView() {
        return ReactNodeViewRenderer(BlockTokenNodeView);
    },
});

export default BlockTokenNode;
