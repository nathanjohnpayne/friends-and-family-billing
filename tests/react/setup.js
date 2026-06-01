import '@testing-library/jest-dom';

// jsdom does not implement Document.prototype.elementFromPoint. TipTap 3.24's
// placeholder viewport-tracking utility calls it via prosemirror-view's
// posAtCoords, which crashes the editor on mount under jsdom. A no-op stub
// returning null (the value a real browser returns when no element is at the
// coordinates) lets the viewport tracking exit gracefully.
if (
    typeof Document !== 'undefined' &&
    typeof Document.prototype.elementFromPoint !== 'function'
) {
    Document.prototype.elementFromPoint = function elementFromPointStub() {
        return null;
    };
}
