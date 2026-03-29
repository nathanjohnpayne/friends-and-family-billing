/**
 * CompanyLogo — reusable logo component with layered fallback strategy.
 *
 * Resolution order:
 * 1. Custom uploaded logo (bill.logo base64 data URI)
 * 2. Logo.dev domain lookup (extracted from bill.website)
 * 3. Logo.dev brand name lookup (/name/{brand})
 * 4. Styled initials fallback
 */
import { useState, useCallback } from 'react';
import { getInitials } from '../../lib/formatting.js';

const LOGODEV_KEY = import.meta.env.VITE_LOGODEV_KEY || '';
const LOGODEV_BASE = 'https://img.logo.dev';

/**
 * Extract a clean domain from a full URL.
 * @param {string} url — e.g. "https://www.t-mobile.com/plans"
 * @returns {string|null} — e.g. "t-mobile.com", or null if invalid
 */
function extractDomain(url) {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
        return null;
    }
}

/**
 * Build a Logo.dev Image CDN URL.
 * @param {string} identifier — domain or "/name/{brand}" path
 * @param {number} displaySize — CSS display size in px
 * @returns {string}
 */
function buildLogoUrl(identifier, displaySize) {
    if (!LOGODEV_KEY) return '';
    const fetchSize = Math.min(displaySize * 2, 800); // retina, capped at API max
    return LOGODEV_BASE + '/' + identifier + '?token=' + LOGODEV_KEY
        + '&size=' + fetchSize + '&format=png&retina=true&fallback=404';
}

/**
 * @param {{ logo?: string, website?: string, name: string, size?: number, className?: string }} props
 */
export default function CompanyLogo({ logo, website, name, size = 48, className = '' }) {
    // 'custom' | 'domain' | 'name' | 'initials'
    const [stage, setStage] = useState(logo ? 'custom' : 'domain');
    const [loaded, setLoaded] = useState(!!logo);

    const domain = extractDomain(website);
    const encodedName = encodeURIComponent(name);

    const handleError = useCallback(() => {
        if (stage === 'domain') {
            // Domain failed — try name lookup
            setStage('name');
            setLoaded(false);
        } else {
            // Name also failed (or was the first attempt) — show initials
            setStage('initials');
        }
    }, [stage]);

    const handleLoad = useCallback(() => {
        setLoaded(true);
    }, []);

    const sizeStyle = { width: size + 'px', height: size + 'px' };
    const cls = 'company-logo ' + className;

    // Stage 1: Custom uploaded logo
    if (logo) {
        return (
            <img
                src={logo}
                alt={name}
                className={cls + ' company-logo-img'}
                style={sizeStyle}
                loading="lazy"
            />
        );
    }

    // Stage 4: Initials fallback
    if (stage === 'initials' || !LOGODEV_KEY) {
        return (
            <div className={cls + ' company-logo-fallback'} style={sizeStyle}>
                {getInitials(name)}
            </div>
        );
    }

    // Stage 2 or 3: Logo.dev lookup
    let src;
    if (stage === 'domain' && domain) {
        src = buildLogoUrl(domain, size);
    } else if (stage === 'domain' && !domain) {
        // No website — skip straight to name lookup
        src = buildLogoUrl('name/' + encodedName, size);
    } else {
        // stage === 'name'
        src = buildLogoUrl('name/' + encodedName, size);
    }

    return (
        <div className={cls + ' company-logo-wrapper'} style={sizeStyle}>
            {!loaded && <div className="company-logo-shimmer" style={sizeStyle} />}
            <img
                src={src}
                alt={name}
                className={'company-logo-img' + (loaded ? '' : ' company-logo-hidden')}
                style={sizeStyle}
                loading="lazy"
                onLoad={handleLoad}
                onError={handleError}
            />
        </div>
    );
}
