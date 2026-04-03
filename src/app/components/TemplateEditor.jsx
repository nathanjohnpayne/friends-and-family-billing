/**
 * TemplateEditor — TipTap WYSIWYG body editor with token pills,
 * formatting toolbar, and slash-command autocomplete.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import TokenNode, { INLINE_TOKENS } from './TokenNode.js';
import BlockTokenNode, { BLOCK_TOKENS } from './BlockTokenNode.js';
import { buildSuggestion } from './SlashCommandMenu.jsx';
import './TemplateEditor.css';

/** All tokens for the slash-command menu. */
const ALL_TOKENS = [
    ...INLINE_TOKENS.map(t => ({ ...t, type: 'inline' })),
    ...BLOCK_TOKENS.map(t => ({ ...t, type: 'block' })),
];

/** Token ID -> label lookup for paste conversion. */
const TOKEN_LOOKUP = Object.fromEntries([
    ...INLINE_TOKENS.map(t => [t.id, t]),
    ...BLOCK_TOKENS.map(t => [t.id, t]),
]);

/** Regex matching %token_id% patterns in pasted text. */
const TOKEN_PATTERN = /%([a-z_]+)%/g;

/**
 * Build a TipTap Suggestion extension for the slash trigger.
 */
function SlashCommands(tokens) {
    return Extension.create({
        name: 'slashCommands',
        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    pluginKey: new PluginKey('slashCommands'),
                    ...buildSuggestion(tokens, '/'),
                }),
            ];
        },
    });
}

/**
 * Build a TipTap Suggestion extension for the % trigger.
 */
function PercentCommands(tokens) {
    return Extension.create({
        name: 'percentCommands',
        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    pluginKey: new PluginKey('percentCommands'),
                    ...buildSuggestion(tokens, '%'),
                }),
            ];
        },
    });
}

/**
 * Convert pasted text containing %token% patterns into a ProseMirror fragment.
 */
function parsePastedTextWithTokens(text) {
    if (!TOKEN_PATTERN.test(text)) return null;
    TOKEN_PATTERN.lastIndex = 0;

    const content = [];
    const lines = text.split('\n');

    for (const line of lines) {
        const para = { type: 'paragraph', content: [] };
        let lastIdx = 0;
        TOKEN_PATTERN.lastIndex = 0;
        let match;

        while ((match = TOKEN_PATTERN.exec(line)) !== null) {
            const before = line.slice(lastIdx, match.index);
            if (before) para.content.push({ type: 'text', text: before });
            const tokenId = match[1];
            const info = TOKEN_LOOKUP[tokenId];
            if (info) {
                const isBlock = BLOCK_TOKENS.some(b => b.id === tokenId);
                if (isBlock) {
                    if (para.content.length > 0) content.push({ ...para });
                    content.push({
                        type: 'blockToken',
                        attrs: { id: tokenId, label: info.label, description: info.description || '' },
                    });
                    para.content = [];
                } else {
                    para.content.push({
                        type: 'templateToken',
                        attrs: { id: tokenId, label: info.label },
                    });
                }
            } else {
                para.content.push({ type: 'text', text: match[0] });
            }
            lastIdx = match.index + match[0].length;
        }

        const remaining = line.slice(lastIdx);
        if (remaining) para.content.push({ type: 'text', text: remaining });
        if (para.content.length > 0) content.push(para);
        else if (content.length > 0 && content[content.length - 1].type !== 'blockToken') {
            content.push({ type: 'paragraph' });
        }
    }

    return content.length > 0 ? content : null;
}

/**
 * TemplateEditor component.
 * Renders: toolbar (inside card) + ProseMirror editor surface.
 * The parent card structure (subject row, chip bar, save bar) is in InvoicingTab.
 */
const TemplateEditor = forwardRef(function TemplateEditor({ content, onUpdate, readOnly, onConfigurePaymentMethods }, ref) {
    // Guard to prevent the content-sync useEffect from re-entrantly calling
    // setContent when the change originated from the editor's own onUpdate.
    const isInternalUpdate = useRef(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                code: false,
            }),
            Link.configure({ openOnClick: false, HTMLAttributes: { class: 'template-link' } }),
            Placeholder.configure({
                placeholder: 'Type your message, or press / to insert a field\u2026',
            }),
            TokenNode,
            BlockTokenNode.configure({ onConfigurePaymentMethods }),
            SlashCommands(ALL_TOKENS),
            PercentCommands(ALL_TOKENS),
        ],
        content: content || undefined,
        editable: !readOnly,
        onUpdate({ editor: ed }) {
            isInternalUpdate.current = true;
            if (onUpdate) onUpdate(ed.getJSON());
        },
        editorProps: {
            handlePaste(view, event) {
                const text = event.clipboardData?.getData('text/plain');
                if (text && TOKEN_PATTERN.test(text)) {
                    TOKEN_PATTERN.lastIndex = 0;
                    const fragment = parsePastedTextWithTokens(text);
                    if (fragment) {
                        view.dispatch(view.state.tr.replaceSelectionWith(
                            view.state.schema.nodeFromJSON({ type: 'doc', content: fragment })
                        ));
                        return true;
                    }
                }
                return false;
            },
        },
    }, [readOnly, onConfigurePaymentMethods]);

    useImperativeHandle(ref, () => editor, [editor]);

    // Sync content when it changes externally (e.g., billing year switch)
    useEffect(() => {
        if (editor && content && !isInternalUpdate.current) {
            const currentJSON = JSON.stringify(editor.getJSON());
            const newJSON = JSON.stringify(content);
            if (currentJSON !== newJSON) {
                editor.commands.setContent(content);
            }
        }
        isInternalUpdate.current = false;
    }, [editor, content]);

    if (!editor) return null;

    return (
        <>
            {!readOnly && <FormattingToolbar editor={editor} />}
            <div className="template-editor-surface">
                <EditorContent editor={editor} />
            </div>
        </>
    );
});

export default TemplateEditor;

function FormattingToolbar({ editor }) {
    function btn(label, command, isActive, title) {
        return (
            <button
                key={title || label}
                type="button"
                className={'template-tb' + (isActive ? ' template-tb--active' : '')}
                onMouseDown={e => { e.preventDefault(); command(); }}
                title={title || label}
            >
                {label}
            </button>
        );
    }

    return (
        <div className="template-toolbar">
            {btn(<strong>B</strong>, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Bold')}
            {btn(<em>I</em>, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italic')}
            {btn('Link', () => {
                if (editor.isActive('link')) {
                    editor.chain().focus().unsetLink().run();
                } else {
                    const url = window.prompt('URL');
                    if (url) editor.chain().focus().setLink({ href: url }).run();
                }
            }, editor.isActive('link'), 'Link')}
            <span className="template-tb-sep" />
            {btn('\u2022', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullet list')}
            {btn('1.', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered list')}
            <span className="template-tb-sep" />
            {btn('\u2014', () => editor.chain().focus().setHorizontalRule().run(), false, 'Horizontal rule')}
        </div>
    );
}
