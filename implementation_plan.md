# Implementation Plan - Web App Optimization

The goal is to fix performance issues with infinite scroll ("still not infinite") and modal re-rendering ("rerenders full"), and ensure a polished "pro" feel with avatars everywhere.

## User Review Required

> [!IMPORTANT]
> **Database Query Strategy Change**: I am switching from OFFSET-based pagination to **Cursor-based pagination** (using `created_at` timestamp).
> The current implementation fetches `0` to `offset + limit` rows to merge two databases, which gets exponentially slower as you scroll.
> The new strategy will fetch `LIMIT 50` where `created_at < last_timestamp`. This is O(1) and Scalable.

## Proposed Changes

### Database Layer (`apps/web/lib/db.ts`)

#### [MODIFY] [db.ts](file:///c:/Users/kush/scrapesavee/apps/web/lib/db.ts)
- Update `getRecentBlocks` to accept `cursor` (timestamp) instead of `offset`.
- Update SQL query to use `WHERE created_at < $cursor` (if cursor provided).
- Remove the `LIMIT offset + limit` logic. Just `LIMIT 50`.
- Handle the merge of two DBs by fetching 50 from each (with cursor), merging, sorting, and taking top 50.
- Return the `nextCursor` (timestamp of the last item) along with blocks.

### Server Actions (`apps/web/app/actions.ts`)

#### [MODIFY] [actions.ts](file:///c:/Users/kush/scrapesavee/apps/web/app/actions.ts)
- Update `loadMoreBlocks` to accept `cursor: string | undefined`.
- Return `{ blocks: Block[], nextCursor?: string }`.

### Components (`apps/web/components`)

#### [MODIFY] [MasonryGrid.tsx](file:///c:/Users/kush/scrapesavee/apps/web/components/MasonryGrid.tsx)
- Refactor to use cursor-based state (`nextCursor`).
- Remove `offset` state.
- Optimize rendering: Check if we can memoize block items or rely on Masonry grid's efficiency.
- Ensure Avatars are rendered correctly (already present, will verify styling).

#### [NEW] [BlockItem.tsx](file:///c:/Users/kush/scrapesavee/apps/web/components/BlockItem.tsx)
- Extract the single block renders from `MasonryGrid` into a memoized component to reduce render cost when appending new items.

### Modal Routing (`apps/web/app/@modal`)

#### [NEW] [default.tsx](file:///c:/Users/kush/scrapesavee/apps/web/app/@modal/default.tsx)
- Create this file returning `null` to ensure proper parallel route behavior on soft navigation/refresh.

## Verification Plan

### Automated Tests
- None existing.

### Manual Verification
1.  **Infinite Scroll Efficiency**:
    -   Scroll down 10-20 "pages" on Home.
    -   Observe network requests; they should remain small (50 items) and fast, not growing in size.
    -   Verify no duplicates.
2.  **Modal Performance**:
    -   Click a block on Home.
    -   Observe if the background (feed) stays stable or reloads.
    -   Close modal; verify scroll position is maintained.
3.  **Avatar Check**:
    -   Verify avatars appear on Block Cards (Home).
    -   Verify avatars appear on Block Details (Modal).
