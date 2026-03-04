# Align Homepage Composition with Neo-Plasticism Principles (Mondrian Compliance Pass)

## Summary

The current homepage composition successfully references Piet Mondrian
visually but diverges from core Neo‑Plasticism principles in
proportional logic, spatial hierarchy, and material treatment.\
This ticket removes decorative and hierarchical behaviors so the layout
functions as a true dynamic equilibrium system rather than a styled grid
UI.

------------------------------------------------------------------------

## Problem Statement

The implementation introduces non‑Mondrian behaviors:

1.  Fixed proportional grid ratios\
2.  Decorative lighting/texture overlays\
3.  Hierarchical interaction depth\
4.  Overweighted black mass\
5.  Decorative accent elements\
6.  Symmetrical text anchoring\
7.  Object-like shadowing

These reduce compositional authenticity and weaken visual equilibrium.

------------------------------------------------------------------------

## Goals

-   Achieve dynamic asymmetrical balance\
-   Preserve flat pictorial space\
-   Remove illusionistic depth\
-   Ensure all color areas feel structurally necessary\
-   Maintain Mondrian visual tension during interaction states

------------------------------------------------------------------------

## Scope

Homepage Mondrian layout only.

**Files impacted** - `/style.css` - `/script.js` - `/index.html`

------------------------------------------------------------------------

## Requirements

### 1. Remove Decorative Surface Effects

Delete:

``` css
.mondrian::before
.mondrian::after
.panel::after
.block::after
```

Remove grain, gradients, and noise textures.

**Acceptance Criteria** - All surfaces render perfectly flat. - No
simulated lighting or texture.

------------------------------------------------------------------------

### 2. Eliminate Object Shadowing

Remove container shadows:

``` css
box-shadow: ...
border-radius: 4px;
```

**Acceptance Criteria** - Composition reads as planar system, not
floating card.

------------------------------------------------------------------------

### 3. Convert Grid to Relational Layout

Replace fixed ratios:

``` css
--c1 --c2 --c3 --c4
--r1 --r2 --r3 --r4
```

with responsive relational sizing driven by interaction state only.

**Implementation Notes** - Use intrinsic sizing or `minmax()`. - Avoid
reusable proportional constants.

**Success Metric** No two interaction states share identical
proportional relationships.

------------------------------------------------------------------------

### 4. Flatten Interaction Model

Modify panel behavior.

**Current** - Panels open revealing interior layer.

**New** - Panels rebalance entire grid simultaneously.

**Implementation** Remove opacity reveal animation:

``` css
.panel-content opacity transitions
```

Interaction should: - redistribute space, - not expose hidden depth.

------------------------------------------------------------------------

### 5. Rebalance Black Region

Reduce visual dominance of `.panel--projects`.

Options: - reduce area \~15--20% - introduce adjacent white
counterweight - slightly thicken nearby lines for compensation

**Acceptance Criteria** No single color dominates perceived mass.

------------------------------------------------------------------------

### 6. Remove Decorative Accent Blocks

Delete:

``` css
.block--red-accent
.block--yellow-accent
```

unless they become structural dividers.

**Rule** Color must define structure, never decorate edges.

------------------------------------------------------------------------

### 7. De‑Center Typography

Adjust label placement:

-   offset text within rectangles
-   align to grid tension lines
-   avoid visual midpoint anchoring

**Acceptance Criteria** No major text element sits at geometric center.

------------------------------------------------------------------------

## Definition of Done

-   Composition reads as balanced without interaction.
-   Interaction preserves equilibrium rather than revealing layers.
-   No gradients, textures, shadows, or decorative color.
-   Layout feels inevitable rather than designed.

------------------------------------------------------------------------

**Priority:** P2 (Design Integrity)\
**Owner:** Frontend\
**Design Review Required:** Yes
