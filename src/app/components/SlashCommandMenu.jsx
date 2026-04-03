/**
 * SlashCommandMenu — autocomplete popover for inserting tokens via / or %.
 * Built on @tiptap/suggestion. Used by TemplateEditor and SubjectEditor.
 */
import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * The rendered popover component. Receives items + command from TipTap Suggestion.
 */
const SlashCommandList = forwardRef(function SlashCommandList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef(null);

    useEffect(() => {
        setSelectedIndex(0);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
        if (menuRef.current) {
            const el = menuRef.current.children[selectedIndex];
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex]);

    const selectItem = useCallback((index) => {
        const item = items[index];
        if (item) command(item);
    }, [items, command]);

    useImperativeHandle(ref, () => ({
        onKeyDown({ event }) {
            if (event.key === 'ArrowUp') {
                setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
                return true;
            }
            if (event.key === 'ArrowDown') {
                setSelectedIndex((prev) => (prev + 1) % items.length);
                return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                selectItem(selectedIndex);
                return true;
            }
            if (event.key === 'Escape') {
                return true;
            }
            return false;
        },
    }));

    if (items.length === 0) return null;

    // Split into inline tokens and block tokens
    const inlineItems = items.filter(i => i.type === 'inline');
    const blockItems = items.filter(i => i.type === 'block');
    let flatIndex = 0;

    function renderItem(item) {
        const idx = flatIndex++;
        return (
            <button
                key={item.id}
                className={'slash-command-item' + (idx === selectedIndex ? ' slash-command-item--selected' : '')}
                type="button"
                onClick={() => selectItem(idx)}
                onMouseEnter={() => setSelectedIndex(idx)}
            >
                <span className="slash-command-item-label">{item.label}</span>
                <span className="slash-command-item-type">{item.type === 'block' ? 'block' : 'text field'}</span>
            </button>
        );
    }

    return (
        <div className="slash-command-menu" ref={menuRef}>
            {inlineItems.map(renderItem)}
            {blockItems.length > 0 && inlineItems.length > 0 && (
                <div className="slash-command-separator" />
            )}
            {blockItems.map(renderItem)}
        </div>
    );
});

/**
 * Build a TipTap Suggestion configuration object.
 * @param {Array} tokens — combined inline + block token list with { id, label, type, ... }
 * @param {string} char — trigger character ('/' or '%')
 */
export function buildSuggestion(tokens, char) {
    let popupRef = null;
    let componentRef = null;
    let popupRoot = null;

    return {
        char,
        allowSpaces: false,
        startOfLine: false,

        items({ query }) {
            const q = query.toLowerCase();
            return tokens.filter(t => t.label.toLowerCase().includes(q));
        },

        command({ editor, range, props: item }) {
            if (item.type === 'block') {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'blockToken',
                    attrs: { id: item.id, label: item.label, description: item.description || '' },
                }).run();
            } else {
                editor.chain().focus().deleteRange(range).insertContent({
                    type: 'templateToken',
                    attrs: { id: item.id, label: item.label },
                }).run();
            }
        },

        render() {
            return {
                onStart(props) {
                    popupRef = document.createElement('div');
                    popupRef.className = 'slash-command-popup';
                    document.body.appendChild(popupRef);

                    popupRoot = createRoot(popupRef);

                    updatePopup(props);
                },

                onUpdate(props) {
                    updatePopup(props);
                },

                onKeyDown(props) {
                    if (props.event.key === 'Escape') {
                        cleanup();
                        return true;
                    }
                    return componentRef?.onKeyDown(props) || false;
                },

                onExit() {
                    cleanup();
                },
            };

            function updatePopup(props) {
                if (!popupRef || !popupRoot) return;
                const rect = props.clientRect?.();
                if (rect) {
                    popupRef.style.position = 'fixed';
                    popupRef.style.left = rect.left + 'px';
                    popupRef.style.top = rect.bottom + 4 + 'px';
                    popupRef.style.zIndex = '9999';
                }
                popupRoot.render(
                    <SlashCommandList
                        ref={(r) => { componentRef = r; }}
                        items={props.items}
                        command={props.command}
                    />
                );
            }

            function cleanup() {
                if (popupRoot) {
                    popupRoot.unmount();
                    popupRoot = null;
                }
                if (popupRef) {
                    popupRef.remove();
                    popupRef = null;
                }
                componentRef = null;
            }
        },
    };
}

export default SlashCommandList;
