# File Browser Scroll Design

## Context

The Vibe Researcher page currently shows Knowledge Base and Project Files entries in paged lists. Each list renders the first five items and then exposes a `Load More` button. The user wants every Knowledge Base and Project Files browser on this page to keep a compact height and scroll after roughly five visible items instead of paging.

## Goals

- Keep all Knowledge Base and Project Files browsers visually compact.
- Show about five file cards in one view, then scroll for additional entries.
- Apply the same behavior to every matching browser in `VibeResearcherPanel`.
- Preserve loading, empty, error, navigation, and preview behaviors.

## Non-Goals

- No changes to backend file-tree APIs.
- No changes to preview rendering or file-open actions.
- No virtualization or search changes.

## Recommended Approach

Replace the existing display-limit and `Load More` behavior with a shared scroll container for every Knowledge Base and Project Files list in `VibeResearcherPanel`.

### Rendering

- Render the full `kbTreeEntries` and `projectTreeEntries` arrays in their existing list locations.
- Remove the `slice(...displayLimit)` calls and `Load More` buttons.
- Keep all list item buttons and click handlers unchanged.

### Styling

- Reuse the shared `.vibe-git-file-list` class as the scroll container for all file browsers.
- Tune the container height to approximately five rows on desktop.
- Keep the existing tree-layout override, but align it with the same five-item target.
- Preserve mobile behavior by allowing the list to shrink slightly on narrower screens while remaining scrollable.

### State

- Remove `MODULE_LIST_PAGE_SIZE`, `projectFilesDisplayLimit`, and `kbFilesDisplayLimit`.
- Remove the related reset calls when folder/project state changes.
- Leave all file-tree fetch, refresh, root, up, and preview state untouched.

## Risks

- If card heights vary significantly because of long filenames, the visible count may be slightly under or over five. This is acceptable because the requirement is approximate.
- The page has multiple file browser placements; missing one would create inconsistent behavior. Verification should cover each rendered list location in the component.

## Verification

- Confirm no `Load More` buttons remain in the relevant file browser sections.
- Build the frontend successfully.
- Manually verify that each Knowledge Base and Project Files list shows a fixed-height scroll area with about five visible entries.
