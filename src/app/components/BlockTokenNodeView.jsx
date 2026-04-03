/**
 * BlockTokenNodeView — React node view for block-level tokens.
 * Renders a card with label, description, and contextual "Configure" action.
 */
import { NodeViewWrapper } from '@tiptap/react';

export default function BlockTokenNodeView({ node, extension }) {
    const { id, label, description } = node.attrs;
    const onConfigure = extension.options.onConfigurePaymentMethods;

    return (
        <NodeViewWrapper className="block-token-card" contentEditable={false}>
            <div className="block-token-card-body">
                <span className="block-token-card-label">{label}</span>
                {description && (
                    <span className="block-token-card-desc">{description}</span>
                )}
            </div>
            {id === 'payment_methods' && onConfigure && (
                <button
                    className="btn btn-sm btn-secondary"
                    type="button"
                    onClick={onConfigure}
                >
                    Configure
                </button>
            )}
        </NodeViewWrapper>
    );
}
