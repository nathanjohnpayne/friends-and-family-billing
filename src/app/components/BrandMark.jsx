/**
 * BrandMark — the FFB mark: an Ember tile with an Ink receipt glyph
 * (plans/ffb-wireframes.html, "Visual system"). Shared by the nav wordmark
 * and the sign-in wordmark. The fills live in shell.css (.nav-brand-tile /
 * .nav-brand-glyph) so they resolve from the design tokens; logo.svg and
 * favicon.svg carry the same mark with literal hex. Always decorative: the
 * wordmark text beside it carries the name.
 */
export default function BrandMark() {
    return (
        <svg className="nav-brand-icon" viewBox="0 0 48 48" aria-hidden="true">
            <rect className="nav-brand-tile" width="48" height="48" rx="12" />
            <g transform="translate(6,5) scale(1.5)">
                <path className="nav-brand-glyph" d="M11,10A6,6,0,0,0,6,4.09V4A2,2,0,0,1,8,2H20a2,2,0,0,1,2,2V21a1,1,0,0,1-1.39.92l-1.95-.83-1.94.83a1,1,0,0,1-.78,0L14,21.09l-1.94.83a1,1,0,0,1-.78,0l-1.94-.83-1.94.83A1,1,0,0,1,7,22a1,1,0,0,1-.55-.17A1,1,0,0,1,6,21V15.91A6,6,0,0,0,11,10Z" />
                <path className="nav-brand-glyph nav-brand-glyph-detail" d="M8,11.5A2.5,2.5,0,0,1,6,14V14a1,1,0,0,1-2,0H3a1,1,0,0,1,0-2H5.5a.5.5,0,0,0,0-1h-1A2.5,2.5,0,0,1,4,6.05V6A1,1,0,0,1,6,6H7A1,1,0,0,1,7,8H4.5a.5.5,0,0,0,0,1h1A2.5,2.5,0,0,1,8,11.5ZM13,16h5a1,1,0,0,0,0-2H13a1,1,0,0,0,0,2Zm2-4h3a1,1,0,0,0,0-2H15a1,1,0,0,0,0,2Z" />
            </g>
        </svg>
    );
}
