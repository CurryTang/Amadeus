# Activity Feed Design

## Goal

Collapse the separate `Recent Runs` and `Observed Sessions` panels into one shared workspace area while keeping the two item types visually distinct.

## Approved Direction

- Replace the two stacked cards with a single `Activity` panel.
- Render one mixed horizontal feed inside that panel.
- Keep ordering conservative for this iteration:
  - runs first
  - observed sessions second
- Differentiate item types locally on the card with a compact top-right label:
  - `Run`
  - `Session`
- Replace the duplicated top-right count labels with compact summary chips in the panel header:
  - `Runs N`
  - `Sessions N`
- Use one shared empty state instead of two empty cards.

## Non-Goals

- No chronological merge across both sources in this change.
- No change to run detail behavior.
- No change to observed-session refresh or open-node behavior.

## UX Notes

- The current layout creates unnecessary vertical space and a repeated empty-state experience.
- A single panel reduces scanning cost and keeps related operational activity in one place.
- Grouped ordering preserves the current mental model while still improving density.
