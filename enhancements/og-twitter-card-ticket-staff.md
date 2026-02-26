# \[FE\] Add Open Graph + Twitter Card Metadata (Staff-Level Implementation)

**Type:** Enhancement\
**Priority:** Medium\
**Component:** Web / SEO / Share Unfurl\
**Status:** Ready for Dev

------------------------------------------------------------------------

## Summary

Enable deterministic, branded link previews when
`https://nathanpayne.com` is shared across messaging and social
platforms by implementing complete Open Graph and Twitter Card metadata.

This version includes **staff-level reliability improvements** to ensure
consistent rendering across iMessage, Slack, LinkedIn, and X crawlers.

Preview image:

    /og-image.png

------------------------------------------------------------------------

## Why This Matters (Staff-Level Context)

Social crawlers are inconsistent and cache aggressively. Partial
implementations frequently fail on:

-   LinkedIn first scrape
-   iMessage caching behavior
-   Slack unfurl retries
-   Twitter image cropping
-   Canonical URL mismatches

This implementation ensures **crawler determinism** and minimizes
preview failures.

------------------------------------------------------------------------

## Current Architecture

Static Firebase Hosting SPA:

-   All routes rewrite → `/index.html`
-   Crawlers only read initial HTML response
-   Metadata must live in root document

Firebase config confirms SPA rewrite behavior.

------------------------------------------------------------------------

## Required Change

Update:

    /index.html

Insert metadata inside `<head>` immediately after the existing
description meta tag.

------------------------------------------------------------------------

## Implementation (Complete Metadata Block)

``` html
<!-- Canonical -->
<link rel="canonical" href="https://nathanpayne.com/" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Nathan Payne" />
<meta property="og:title" content="Nathan Payne | Product Leader" />
<meta property="og:description" content="Nathan Payne — systems-minded product leader across technology, finance, and design." />
<meta property="og:url" content="https://nathanpayne.com/" />
<meta property="og:image" content="https://nathanpayne.com/og-image.png" />
<meta property="og:image:width" content="2014" />
<meta property="og:image:height" content="2014" />
<meta property="og:image:alt" content="Nathan Payne portfolio homepage preview" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Nathan Payne | Product Leader" />
<meta name="twitter:description" content="Nathan Payne — systems-minded product leader across technology, finance, and design." />
<meta name="twitter:image" content="https://nathanpayne.com/og-image.png" />
<meta name="twitter:image:alt" content="Nathan Payne portfolio homepage preview" />
```

------------------------------------------------------------------------

## Staff-Level Improvements Included

### 1. Canonical URL

Prevents preview fragmentation between:

-   `www`
-   non-www
-   trailing slash variants

### 2. og:site_name

Improves LinkedIn + Slack rendering consistency.

### 3. Image Alt Text

Accessibility + improves fallback previews on some crawlers.

### 4. Absolute URLs Only

Required for iMessage + LinkedIn bots.

### 5. Single Source Metadata

Placed only in `/index.html` to align with SPA rewrite model.

------------------------------------------------------------------------

## Image Specification

-   File: `/og-image.png`
-   Location: project root
-   Dimensions: **2014 × 2014 px**
-   Public HTTPS access required
-   No authentication or redirects

------------------------------------------------------------------------

## Acceptance Criteria

✅ Sharing `https://nathanpayne.com` produces consistent previews in:

-   iMessage
-   Slack
-   WhatsApp
-   X (Twitter)
-   LinkedIn
-   Discord

✅ Preview shows:

-   Correct title
-   Description
-   Mondrian portfolio image

✅ No generic or missing thumbnails.

------------------------------------------------------------------------

## Validation

After deploy:

1.  Force re-scrape:
    -   Twitter Card Validator
    -   LinkedIn Post Inspector
    -   Facebook Sharing Debugger
2.  Paste URL into:
    -   Slack
    -   iMessage
    -   LinkedIn message composer
3.  Confirm consistent unfurl.

------------------------------------------------------------------------

## Definition of Done

-   Metadata present in production HTML
-   All validators pass
-   Stable preview rendering across platforms
-   No crawler errors
