/**
 * SubjectEditor — constrained single-line TipTap editor with token pills.
 * No rich formatting, no block tokens, no line breaks.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import TokenNode, { INLINE_TOKENS } from './TokenNode.js';
import { buildSuggestion } from './SlashCommandMenu.jsx';

/** Token regex for parsing subject strings. */
const TOKEN_REGEX = /%([a-z_]+)%/g;

/** Token ID → info lookup. */
const TOKEN_MAP = Object.fromEntries(INLINE_TOKENS.map(t => [t.id, t]));

/** Tokens for slash-command menu (inline only, no block tokens). */
const SUBJECT_TOKENS = INLINE_TOKENS.map(t => ({ ...t, type: 'inline' }));

/**
 * Convert a subject string with %token% patterns to ProseMirror JSON.
 */
export function subjectStringToDoc(text) {
    if (!text) return { type: 'doc', content: [{ type: 'paragraph' }] };

    const nodes = [];
    let lastIdx = 0;
    TOKEN_REGEX.lastIndex = 0;
    let match;

    while ((match = TOKEN_REGEX.exec(text)) !== null) {
        const before = text.slice(lastIdx, match.index);
        if (before) nodes.push({ type: 'text', text: before });
        const info = TOKEN_MAP[match[1]];
        if (info) {
            nodes.push({
                type: 'templateToken',
                attrs: { id: info.id, label: info.label },
            });
        } else {
            nodes.push({ type: 'text', text: match[0] });
        }
        lastIdx = match.index + match[0].length;
    }

    const remaining = text.slice(lastIdx);
    if (remaining) nodes.push({ type: 'text', text: remaining });

    return {
        type: 'doc',
        content: [{ type: 'paragraph', content: nodes.length > 0 ? nodes : undefined }],
    };
}

/**
 * Slash-command extension for subject editor (inline tokens only).
 */
function SubjectSlashCommands() {
    return Extension.create({
        name: 'subjectSlashCommands',
        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    pluginKey: new PluginKey('subjectSlash'),
                    ...buildSuggestion(SUBJECT_TOKENS, '/'),
                }),
            ];
        },
    });
}

/**
 * SubjectEditor component.
 * @param {string} content — subject string with %token% patterns
 * @param {Function} onUpdate — (plainText) callback
 * @param {boolean} readOnly
 * @param {string} placeholder — optional placeholder text
 */
const SubjectEditor = forwardRef(function SubjectEditor({ content, onUpdate, readOnly, placeholder }, ref) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                code: false,
                blockquote: false,
                bulletList: false,
                orderedList: false,
                listItem: false,
                horizontalRule: false,
                hardBreak: false,
                bold: false,
                italic: false,
                strike: false,
            }),
            TokenNode,
            Placeholder.configure({
                placeholder: placeholder || 'Annual Billing Summary %billing_year%\u2014%full_name%',
            }),
            SubjectSlashCommands(),
        ],
        content: subjectStringToDoc(content),
        editable: !readOnly,
        onUpdate({ editor: ed }) {
            if (onUpdate) onUpdate(ed.getText());
        },
        editorProps: {
            handleKeyDown(view, event) {
                if (event.key === 'Enter') return true;
                return false;
            },
            handlePaste(view, event) {
                const text = event.clipboardData?.getData('text/plain');
                if (!text) return false;
                // Strip newlines
                const clean = text.replace(/[\r\n]+/g, ' ');
                // Check for tokens
                if (/%[a-z_]+%/.test(clean)) {
                    const nodes = [];
                    let lastIdx = 0;
                    TOKEN_REGEX.lastIndex = 0;
                    let m;
                    while ((m = TOKEN_REGEX.exec(clean)) !== null) {
                        const before = clean.slice(lastIdx, m.index);
                        if (before) nodes.push({ type: 'text', text: before });
                        const info = TOKEN_MAP[m[1]];
                        if (info) {
                            nodes.push({ type: 'templateToken', attrs: { id: info.id, label: info.label } });
                        } else {
                            nodes.push({ type: 'text', text: m[0] });
                        }
                        lastIdx = m.index + m[0].length;
                    }
                    const rem = clean.slice(lastIdx);
                    if (rem) nodes.push({ type: 'text', text: rem });
                    if (nodes.length > 0) {
                        view.dispatch(view.state.tr.replaceSelection(
                            view.state.schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] }).content
                        ));
                        return true;
                    }
                }
                // Plain paste with newline stripping
                if (text !== clean) {
                    view.dispatch(view.state.tr.insertText(clean));
                    return true;
                }
                return false;
            },
        },
    }, [readOnly]);

    useImperativeHandle(ref, () => editor, [editor]);

    // Sync content when it changes externally (e.g., billing year switch)
    const isInternalUpdate = useRef(false);
    useEffect(() => {
        if (editor && content !== undefined && !isInternalUpdate.current) {
            const currentText = editor.getText();
            if (currentText !== content) {
                editor.commands.setContent(subjectStringToDoc(content));
            }
        }
        isInternalUpdate.current = false;
    }, [editor, content]);

    return (
        <div className="subject-editor-wrap">
            <EditorContent editor={editor} className="subject-editor" />
        </div>
    );
});

export default SubjectEditor;
