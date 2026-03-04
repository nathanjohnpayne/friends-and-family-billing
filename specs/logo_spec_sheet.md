# Friends & Family Billing --- Logo Specification & Color System

**Document Type:** Brand Source of Truth\
**Owner:** Product / Design\
**Version:** 1.0\
**Purpose:** Define logo usage, geometry, and a dependable color palette
for consistent implementation across UI, marketing, and product
surfaces.

------------------------------------------------------------------------

# 1. Brand Intent

The logo represents:

> **Closing the financial loop together once per year.**

Core themes:

-   Annual cycle
-   Shared responsibility
-   Settlement & completion
-   Calm financial trust

The visual language should feel:

✅ dependable\
✅ calm\
✅ organized\
❌ energetic fintech\
❌ neon startup aesthetic

------------------------------------------------------------------------

# 2. Logo Concept --- "Annual Loop"

## Meaning

A closed circular loop symbolizes:

-   yearly billing cycle
-   shared participation
-   completion of obligations

A single node represents an individual contributing to the whole.

------------------------------------------------------------------------

## Geometry

### Container

-   Shape: Rounded square
-   Base size: 48×48
-   Corner radius: 12px
-   Background: Gradient (see palette below)

### Loop

-   Diameter: 24px
-   Stroke weight: 2.5px
-   Color: White
-   Gap: 10° opening at \~1--2 o'clock position
-   Optical center: +1px vertical offset

### Node

-   Size: 4px circle
-   Placement: 12 o'clock
-   Slight overlap with loop stroke

Rule:

    Node must visually complete the loop.

------------------------------------------------------------------------

# 3. Clear Space Rules

Minimum clear space = height of node element.

    [ logo ]  ← maintain padding equal to node diameter

No UI elements may enter this space.

------------------------------------------------------------------------

# 4. Minimum Sizes

  Context        Size
  -------------- ----------
  App favicon    16px
  Navigation     24px
  Login screen   48--64px
  Marketing      96px+

Below 16px → use simplified filled loop version.

------------------------------------------------------------------------

# 5. Incorrect Usage (Do Not)

❌ Stretch logo\
❌ Rotate logo arbitrarily\
❌ Change stroke thickness\
❌ Apply glow effects\
❌ Use neon gradients\
❌ Place on low-contrast backgrounds

------------------------------------------------------------------------

# 6. Revised Color Palette

## Goal: Less Neon → More Dependable

Palette tuned for financial trust and long-term usability.

------------------------------------------------------------------------

## Primary Gradient (Logo Background)

  Token                  Color
  ---------------------- ---------
  Brand Primary Top      #6E78D6
  Brand Primary Bottom   #7B5FAF

Characteristics: - Cooler midpoint - Reduced saturation - Stable visual
weight

------------------------------------------------------------------------

## Primary Brand Colors

  Name            Hex       Usage
  --------------- --------- ----------------------
  Indigo Calm     #6E78D6   Primary actions
  Deep Violet     #7B5FAF   Gradients / emphasis
  Slate Ink       #1F2430   Headlines
  Soft Graphite   #5B6475   Body text
  Mist Gray       #E6E8EE   Surfaces
  Cloud White     #F7F8FB   Background

------------------------------------------------------------------------

## Semantic Colors (Adjusted for Trust)

  Purpose   Color     Notes
  --------- --------- --------------------------
  Success   #3FA37C   Muted green (avoid neon)
  Warning   #D6A24A   Warm neutral amber
  Error     #C65A5A   Soft red (non-alarmist)
  Info      #5F86C9   Calm informational blue

------------------------------------------------------------------------

# 7. Accessibility Targets

-   Minimum contrast ratio: **4.5:1**
-   Gradient must not reduce icon visibility.
-   Text never placed directly over gradient without overlay.

------------------------------------------------------------------------

# 8. Logo Variants

## Primary

Gradient container + white loop.

## Monochrome

-   Solid Indigo Calm background
-   White loop

## Neutral

-   Dark ink loop on white background

Used for invoices and print contexts.

------------------------------------------------------------------------

# 9. Motion Guidelines (Optional)

Allowed animation:

-   Rotate loop ≤ 15° during login success.
-   Duration: 180--220ms
-   Ease: ease-out

Purpose: Signal completion, not loading.

Never continuous spinning.

------------------------------------------------------------------------

# 10. Design Tokens (Engineering Reference)

``` css
--brand-primary-top: #6E78D6;
--brand-primary-bottom: #7B5FAF;

--color-ink: #1F2430;
--color-body: #5B6475;
--color-surface: #E6E8EE;
--color-background: #F7F8FB;

--success: #3FA37C;
--warning: #D6A24A;
--error: #C65A5A;
--info: #5F86C9;
```

------------------------------------------------------------------------

# 11. Implementation Notes

-   Logo stroke must scale proportionally.
-   Use SVG for all product contexts.
-   Avoid raster exports except favicon fallback.
-   Maintain geometric consistency across icon system.

------------------------------------------------------------------------

# 12. Future Evolution

Logo geometry may later map to system states:

  State      Visual
  ---------- ---------------
  Open       outlined loop
  Settling   animated node
  Closed     filled loop
  Archived   muted opacity

This enables brand → product language continuity.

------------------------------------------------------------------------

# 13. Ownership

Changes require approval from: - Product - Design

This document is the canonical reference for all logo usage.
