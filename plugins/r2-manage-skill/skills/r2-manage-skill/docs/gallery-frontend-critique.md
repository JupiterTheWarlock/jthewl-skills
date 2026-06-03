# R2 Gallery Frontend Critique

Date: 2026-06-02

Scope: `scripts/r2-gallery.js`, the local R2 asset browser served at `http://127.0.0.1:8787/`.

## Context

The gallery is a product UI for repeated asset browsing work, not a landing page. The target experience should stay close to the `jthewl-skills-hub` app shell:

- dark terminal/cyberpunk base
- Claude Code Orange accent
- tree-first information architecture
- restrained gradients
- self-drawn filter dropdowns using the Skills Hub `FilterMenu` pattern

This review used the local page, source inspection, the bundled `impeccable` detector, and 1440px plus 390px headless Chrome screenshots.

## Design Health Score

| Heuristic | Score | Current issue |
|---|---:|---|
| Visibility of system status | 3/4 | Loading, count, and copy feedback exist, but copy failure and API errors need clearer recovery. |
| Match between system and real world | 3/4 | Path tree plus asset grid fits image-hosting browsing. |
| User control and freedom | 2/4 | There is no clear reset for filters, no full keyboard escape behavior for dropdown/dialog states. |
| Consistency and standards | 3/4 | Close to Skills Hub, but header/action density and some component states still diverge. |
| Error prevention | 2/4 | `max` and `prefix` accept weakly constrained input. |
| Recognition rather than recall | 3/4 | Main actions are visible and labeled. |
| Flexibility and efficiency | 2/4 | No keyboard shortcuts, batch copy, or quick tree expand/collapse. |
| Aesthetic and minimalist design | 3/4 | Good information density, but mobile overflow hurts trust. |
| Error recovery | 2/4 | Error UI exposes raw messages and lacks task-specific next steps. |
| Help and documentation | 2/4 | Empty states are too thin for first-time or edge-case use. |
| Total | 27/40 | Usable foundation, needs adapt and polish work. |

## What Works

- The tree-first layout matches the job: browsing bucket paths and filtering loaded assets.
- The filter dropdown direction is now aligned with Skills Hub: trigger button, listbox popup, option buttons.
- Image thumbnails are constrained well enough on desktop to keep Copy URL and Open visible.
- The palette is mostly aligned with the consensus orange-on-dark system and avoids the earlier overuse of gradients.

## Priority Backlog

### P1: Fix Mobile Horizontal Overflow

Evidence: at 390px width the header, tree panel, and asset grid overflow to the right. This makes the page feel broken on mobile even though the desktop layout is usable.

Likely causes:

- form controls and grid children are missing enough `min-width: 0`
- the mobile media rule only changes `form` columns, but does not force contained controls to shrink
- the asset grid can still behave like a desktop grid in a narrow viewport

Fix direction:

- add `min-width: 0` to header sections, labels, form children, `.filterMenu`, `.asset-panel`, and grid items
- at very narrow widths, make the form single-column or use `grid-template-columns: repeat(2, minmax(0, 1fr))`
- at under 480px, force `.grid` to one column or use a smaller `minmax`
- verify with a 390px viewport screenshot after the change

### P1: Harden Filter Menu Positioning

The dropdown is visually correct now, but `.filterMenuList` is still absolutely positioned inside the header/form stack. Future overflow rules or narrow screens can clip it.

Fix direction:

- ensure ancestors of `.filterMenuList` do not clip overflow
- give the menu a mobile-safe width
- consider a popover or fixed-position implementation if clipping returns
- add keyboard behavior: Escape closes, Enter selects, ArrowUp/ArrowDown moves focus

### P2: Improve Copy Feedback and Recovery

The current Copy URL interaction changes the button label to `Copied`, but clipboard failures have no visible recovery.

Fix direction:

- use the Skills Hub copy state pattern: copied key, copy error key, timeout reset
- add a textarea fallback for environments where `navigator.clipboard.writeText` fails
- show `Copy failed` or an error icon briefly, then restore the label

### P2: Make Empty and Error States Task-Specific

Current empty states such as `No matching assets.` and `No paths loaded.` do not explain which filter caused the result.

Fix direction:

- show the active prefix, type, and search query in empty states
- add a clear filters action
- distinguish R2 credential/API errors from normal no-result states
- avoid raw JSON or SDK error text unless expanded in a detail view

### P2: Quiet the Header on Mobile

The header is task chrome, not a hero. On mobile it consumes too much vertical space and then contributes to overflow.

Fix direction:

- keep avatar and brand on desktop
- compact the brand row on mobile
- move status closer to the result panel
- keep Search, Prefix, Max, Type, and Refresh in a predictable compact toolbar

### P3: Add Product UI State Completeness

The current UI has basic hover/focus states, but lacks a complete product-state vocabulary.

Fix direction:

- disabled state for Refresh and Load more while loading
- visible focus for tree nodes, asset thumbnails, action buttons, and dialog close
- reduced-motion guard if transitions are added
- consistent selected/active styling across tree and filter options

## Accessibility Notes

- The custom filter menu has ARIA attributes, but it is not yet a complete keyboard listbox.
- The dialog should support predictable Escape behavior and focus restoration to the opened thumbnail.
- Image `alt` currently mirrors object keys. That is acceptable for a file browser, but object metadata description could be used in the detail dialog if available.
- Touch targets are mostly large enough, but mobile overflow must be fixed before touch ergonomics can be trusted.

## Suggested Implementation Order

1. Mobile overflow and layout constraints.
2. Filter menu keyboard and clipping hardening.
3. Copy feedback fallback and error state polish.
4. Empty state and API error copy.
5. Optional efficiency additions: batch copy, clear filters, keyboard shortcuts.

## Verification Checklist

- `npm test`
- `node --check scripts/r2-gallery.js`
- HTTP check for `/` and `/api/objects?max=20`
- desktop screenshot at 1440px width
- mobile screenshot at 390px width
- manual dropdown open/close on mobile
- manual copy success and simulated copy failure

