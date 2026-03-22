/**
 * SMS helpers — extracted from legacy main.js:4465 for React consumption.
 * Pure functions except openSmsComposer which uses window/navigator.
 */

/**
 * Build a platform-aware SMS deep link (mirrors main.js:4465).
 * @param {string} phone — E.164 phone number
 * @param {string} body — message text
 * @returns {string|null} — sms: URI or null if platform unsupported
 */
export function buildSmsDeepLink(phone, body) {
    const encodedBody = encodeURIComponent(body);
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const recipient = phone || '';
    if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return 'sms:' + recipient + '&body=' + encodedBody;
    if (/Android/.test(ua)) return 'sms:' + recipient + '?body=' + encodedBody;
    return null;
}

/**
 * Open the native SMS composer or copy to clipboard as fallback (mirrors main.js:4474).
 * @param {string} phone
 * @param {string} body
 * @param {function} [onCopied] — callback when text is copied (fallback path)
 */
export function openSmsComposer(phone, body, onCopied) {
    const link = buildSmsDeepLink(phone, body);
    if (link) {
        window.location.href = link;
    } else {
        navigator.clipboard.writeText(body).then(function () {
            if (onCopied) onCopied();
        });
    }
}
