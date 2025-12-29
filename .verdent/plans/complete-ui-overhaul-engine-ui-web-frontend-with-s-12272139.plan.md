# Complete UI Overhaul Plan

## Objective

Remove all existing UI code and rebuild both the **Engine UI** (admin dashboard in `apps/cms`) and **Web Frontend** (public gallery in `apps/web`) from scratch using the shadcn Maia preset with a professional, cohesive design system.

---

## Part 1: Project Initialization

### 1.1 Clean Slate - Files to Remove

**Engine UI (apps/cms):**

```
apps/cms/src/components/EngineUI.tsx
apps/cms/src/components/EngineView.tsx
apps/cms/src/components/EngineSandbox.tsx
apps/cms/src/components/ModeToggle.tsx
apps/cms/src/components/ThemeProvider.tsx
apps/cms/src/components/useEnginePortalContainer.ts
apps/cms/src/app/(payload)/engine.css
apps/cms/src/app/(payload)/custom.scss
apps/cms/src/components/ui/* (all existing shadcn components)
```

**Web Frontend (apps/web):**

```
apps/web/app/* (entire app directory)
apps/web/components/* (entire components directory)
apps/web/lib/* (entire lib directory - except db.ts, actions.ts)
apps/web/tailwind.config.ts
apps/web/postcss.config.js
apps/web/components.json
```

### 1.2 Fresh Installation

**Both Projects - Initialize with Maia Preset:**

```bash
# In apps/web (new project)
npx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=maia&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default&template=next" --template next

# In apps/cms (integrate into existing Payload)
npx shadcn@latest init --preset "https://ui.shadcn.com/init?base=radix&style=maia&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default"
```

**Shared Design Tokens (Maia Style):**

- Base: Radix UI primitives
- Style: Maia (geometric, clean, minimal)
- Base Color: Neutral (gray scale)
- Icon Library: Lucide React
- Font: Inter (Google Fonts)
- Radius: Default (0.5rem)

---

## Part 2: Engine UI Architecture

### 2.1 Page Structure

```
apps/cms/src/app/engine/
├── layout.tsx          # Engine shell with nav, theme toggle
├── page.tsx            # Dashboard overview (redirect to /jobs)
├── jobs/
│   ├── page.tsx        # Job list with filters
│   └── [jobId]/
│       └── page.tsx    # Job detail with logs
├── sources/
│   └── page.tsx        # Source management
├── runs/
│   └── page.tsx        # Run history
└── settings/
    └── page.tsx        # Configuration
```

### 2.2 Component Architecture

```
components/engine/
├── layout/
│   ├── EngineShell.tsx         # Main layout wrapper
│   ├── Sidebar.tsx             # Collapsible navigation
│   ├── Header.tsx              # Top bar with search, theme, user
│   └── Breadcrumb.tsx          # Navigation breadcrumb
├── dashboard/
│   ├── StatsGrid.tsx           # KPI cards (running, queued, etc.)
│   ├── CapacityGauge.tsx       # R2/DB usage meters
│   ├── ActivityFeed.tsx        # Recent events stream
│   └── QuickActions.tsx        # Common action buttons
├── jobs/
│   ├── JobsTable.tsx           # DataTable with sorting/filtering
│   ├── JobCard.tsx             # Compact job preview card
│   ├── JobDetail.tsx           # Full job view with tabs
│   ├── JobForm.tsx             # Create/edit job form
│   ├── JobControls.tsx         # Action buttons (run, pause, stop)
│   ├── JobLogs.tsx             # Real-time log viewer
│   ├── LogEntry.tsx            # Single log row
│   └── IntervalEditor.tsx      # Schedule configuration
├── sources/
│   ├── SourcesTable.tsx        # Source listing
│   ├── SourceForm.tsx          # Add/edit source
│   └── SourceStats.tsx         # Per-source metrics
├── shared/
│   ├── StatusBadge.tsx         # Colored status indicator
│   ├── ConfirmDialog.tsx       # Delete/action confirmation
│   ├── EmptyState.tsx          # No data placeholder
│   ├── LoadingSkeleton.tsx     # Loading states
│   └── RefreshIndicator.tsx    # Auto-refresh status
└── providers/
    ├── EngineProvider.tsx      # Global state context
    └── ThemeProvider.tsx       # Dark/light mode
```

### 2.3 UX Design - Dashboard

**Layout:**

- Fixed sidebar (280px) with collapse to icons (64px)
- Top header (64px) with search, notifications, theme toggle
- Main content area with 24px padding
- Responsive: sidebar becomes bottom nav on mobile

**Dashboard Cards (4-column grid):**

| Card | Content | Visual |
| --- | --- | --- |
| Running Jobs | Count + worker parallelism | Animated pulse dot |
| Queued Jobs | Count + next scheduled | Queue icon |
| Success Rate | % + trend arrow | Mini line chart |
| Capacity | R2 + DB usage bars | Dual progress bars |

**Activity Feed:**

- Real-time event stream (WebSocket/SSE)
- Event types: Job Started, Completed, Error, Paused
- Timestamps, job links, user actions
- Max 50 items, infinite scroll

### 2.4 UX Design - Jobs List

**Table Features:**

| Column | Content | Interaction |
| --- | --- | --- |
| Status | Colored dot + label | Filter dropdown |
| URL | Truncated with tooltip | Click to detail |
| Type | home/pop/user badge | Filter chips |
| Progress | found/uploaded/errors | Inline sparkline |
| Last Run | Relative time | Sort toggle |
| Next Run | Countdown or "Manual" | Sort toggle |
| Actions | Icon buttons | Dropdown menu |

**Filters (Toolbar):**

- Search box (URL, username)
- Status multi-select (checkboxes)
- Type filter (radio: All, Home, Pop, User)
- Date range picker (Last Run)

**Bulk Actions:**

- Select multiple rows (checkbox column)
- Bulk pause, resume, delete
- Confirmation modal with count

### 2.5 UX Design - Job Detail

**Tabs:**

1. **Overview** - Stats cards, schedule info, last run summary
2. **Logs** - Real-time streaming log table
3. **History** - Past runs with metrics comparison
4. **Settings** - URL, max items, interval, backoff

**Log Viewer (Full-height panel):**

- 5-column table: Time | Stage | URL | Status | Duration
- Color-coded rows: success=green, error=red, pending=gray
- Auto-scroll with "Jump to latest" FAB
- Search/filter within logs
- Export to JSON/CSV

**Control Bar (Sticky bottom):**

- Status badge (large)
- Primary action button (context-aware):
  - Idle → "Run Now"
  - Running → "Pause"
  - Paused → "Resume"
  - Error → "Retry"
- Secondary: Stop, Edit, Delete
- Force toggle for capacity override

### 2.6 UX Design - Add Job Form

**Multi-step or Single Form:**

1. **URL Input** (textarea, supports bulk)

   - Auto-detect source type as user types
   - Validation: savee.it/savee.com URLs only
   - Bulk mode: show URL count badge

2. **Configuration**

   - Max Items: number input with preset buttons (50, 100, 500, All)
   - Schedule: Enable/disable with interval picker
   - Backoff: Toggle with explanation tooltip

3. **Confirmation**

   - Preview: Source type, username (if user), estimated time
   - Capacity check: Warning if near limits
   - Submit button with loading state

### 2.7 State Management

**Context: EngineProvider**

```typescript
interface EngineState {
  jobs: Job[]
  metrics: Metrics
  limits: Limits
  selectedJobs: string[]
  filters: JobFilters
  refreshInterval: number
}

interface EngineActions {
  fetchJobs(): Promise<void>
  controlJob(id: string, action: JobAction): Promise<void>
  createJob(data: CreateJobData): Promise<void>
  deleteJob(id: string, scope: DeleteScope): Promise<void>
  setFilters(filters: Partial<JobFilters>): void
}
```

**Data Fetching:**

- SWR or React Query for caching + auto-refresh
- 2-second polling interval for jobs/metrics
- EventSource for real-time logs
- Optimistic updates for control actions

### 2.8 Interactions & Animations

| Action | Animation |
| --- | --- |
| Page transition | Fade + slight Y translate |
| Sidebar collapse | Width transition 300ms |
| Card hover | Subtle shadow + scale(1.01) |
| Status change | Pulse animation on dot |
| Log entry | Slide in from top |
| Modal open | Scale up from 95% + fade |
| Toast notification | Slide in from top-right |
| Loading skeleton | Shimmer gradient |

---

## Part 3: Web Frontend Architecture

### 3.1 Page Structure

```
apps/web/app/
├── layout.tsx              # Root layout with nav, footer
├── page.tsx                # Home feed (latest blocks)
├── pop/
│   └── page.tsx            # Popular/trending blocks
├── block/
│   └── [id]/
│       └── page.tsx        # Block detail (full page)
├── @modal/
│   └── (.)block/
│       └── [id]/
│           └── page.tsx    # Block detail (modal)
├── users/
│   ├── page.tsx            # Curators directory
│   └── [username]/
│       └── page.tsx        # User profile + blocks
├── search/
│   └── page.tsx            # Search results
└── api/
    └── image/
        └── route.ts        # R2 signed URL proxy
```

### 3.2 Component Architecture

```
components/
├── layout/
│   ├── NavHeader.tsx           # Sticky header with logo, nav, search
│   ├── Footer.tsx              # Minimal footer
│   ├── MobileNav.tsx           # Bottom navigation on mobile
│   └── ThemeToggle.tsx         # Dark/light switch
├── feed/
│   ├── MasonryGrid.tsx         # Responsive masonry layout
│   ├── BlockCard.tsx           # Individual block thumbnail
│   ├── BlockSkeleton.tsx       # Loading placeholder
│   ├── InfiniteScroll.tsx      # Load more trigger
│   └── FeedHeader.tsx          # Title, sort options
├── block/
│   ├── BlockDetail.tsx         # Full block view
│   ├── BlockImage.tsx          # Optimized image with zoom
│   ├── BlockVideo.tsx          # Video player with controls
│   ├── BlockMeta.tsx           # Title, description, tags
│   ├── BlockColors.tsx         # Color palette display
│   ├── BlockSavedBy.tsx        # Users who saved this
│   └── BlockActions.tsx        # Share, source link, etc.
├── user/
│   ├── UserCard.tsx            # User preview in grid
│   ├── UserHeader.tsx          # Profile header with stats
│   ├── UserAvatar.tsx          # Avatar with fallback
│   └── UserStats.tsx           # Followers, saves, etc.
├── search/
│   ├── SearchBar.tsx           # Expandable search input
│   ├── SearchResults.tsx       # Results grid
│   ├── ColorPicker.tsx         # Spectral color search
│   ├── SearchFilters.tsx       # Filter chips
│   └── RecentSearches.tsx      # Search history
├── shared/
│   ├── Modal.tsx               # Dialog wrapper for block detail
│   ├── Badge.tsx               # Tag/label display
│   ├── Tooltip.tsx             # Info tooltips
│   └── EmptyState.tsx          # No results placeholder
└── providers/
    ├── SettingsProvider.tsx    # User preferences context
    └── ThemeProvider.tsx       # Theme context
```

### 3.3 UX Design - Navigation

**Header (Sticky, 64px):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo]        [Home] [Popular] [Curators]    [Search] [Theme]   │
└─────────────────────────────────────────────────────────────────┘
```

**Mobile Header:**

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo]                                          [Search] [Menu] │
└─────────────────────────────────────────────────────────────────┘
```

**Mobile Bottom Nav:**

```
┌─────────────────────────────────────────────────────────────────┐
│    [Home]      [Popular]      [Curators]      [Settings]        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 UX Design - Home Feed

**Layout:**

- Full-width masonry grid
- Responsive columns: 1 (mobile) → 2 (sm) → 3 (md) → 4 (lg) → 5 (xl)
- Configurable via settings (2-8 columns)
- Configurable gap (0-24px)

**Block Card:**

```
┌─────────────────────────┐
│                         │
│      [Image/Video]      │
│                         │
│  ┌─────────────────┐    │ ← Hover overlay
│  │ Title           │    │
│  │ @username       │    │
│  └─────────────────┘    │
└─────────────────────────┘
```

**Hover State:**

- Overlay fades in (200ms)
- Title + username at bottom
- Subtle scale (1.02) on container
- Video: auto-play on hover

**Infinite Scroll:**

- Intersection Observer at 80% scroll
- Loading indicator (3 skeleton cards)
- End of feed message

### 3.5 UX Design - Block Detail

**Modal Layout (Desktop):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [X Close]                                                       │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │ Title                     │
│                                     │ Description               │
│           [Media]                   │ ─────────────────────     │
│           (60% width)               │ Tags: [tag1] [tag2] ...   │
│                                     │ Colors: [●] [●] [●] ...   │
│                                     │ ─────────────────────     │
│                                     │ Saved by:                 │
│                                     │ [avatar] [avatar] ...     │
│                                     │ ─────────────────────     │
│                                     │ [View Source] [Share]     │
└─────────────────────────────────────┴───────────────────────────┘
```

**Full Page Layout (Mobile/Direct):**

- Media at top (full width)
- Metadata below
- Sticky "Back" button

**Media Viewer:**

- Image: Click to zoom (lightbox)
- Video: Custom controls, loop option
- GIF: Auto-play, no controls

**Metadata Panel:**

- Title (h1, large)
- Description (prose)
- Tags (clickable, navigate to search)
- Colors (clickable, spectral search)
- Saved By (horizontal avatar scroll)
- Source link (external icon)
- Share button (copy link, social)

### 3.6 UX Design - Curators Page

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Curators                                    [Search curators]   │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│ │ Avatar  │ │ Avatar  │ │ Avatar  │ │ Avatar  │ │ Avatar  │     │
│ │ Name    │ │ Name    │ │ Name    │ │ Name    │ │ Name    │     │
│ │ @user   │ │ @user   │ │ @user   │ │ @user   │ │ @user   │     │
│ │ N saves │ │ N saves │ │ N saves │ │ N saves │ │ N saves │     │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**User Card:**

- Large avatar (circle)
- Display name (bold)
- Username (muted)
- Stats: saves count
- Hover: subtle lift

### 3.7 UX Design - User Profile

**Header:**

```
┌─────────────────────────────────────────────────────────────────┐
│      ┌────────┐                                                 │
│      │ Avatar │  Display Name                                   │
│      │  (lg)  │  @username                                      │
│      └────────┘  Bio text here...                               │
│                                                                 │
│      [Saves: N]  [Following: N]  [Followers: N]                 │
└─────────────────────────────────────────────────────────────────┘
```

**Content:**

- Masonry grid of user's blocks
- Same infinite scroll as home
- Filter by media type (optional)

### 3.8 UX Design - Search

**Search Bar (Header):**

- Expandable on click (slides out)
- Autocomplete suggestions
- Recent searches dropdown
- Color picker button

**Color Picker:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Pick a color to search                              [Clear]     │
├─────────────────────────────────────────────────────────────────┤
│ ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐  ← Hue columns                       │
│ │ │ │ │ │ │ │ │ │ │ │ │ │                                       │
│ │ │ │ │ │ │ │ │ │ │ │ │ │  ← Luminance rows                     │
│ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘                                       │
│ [Grayscale: ● ● ● ● ● ● ● ● ● ●]                                │
└─────────────────────────────────────────────────────────────────┘
```

**Search Results:**

- Same masonry grid
- Filter chips: text, color, tags
- Clear filters button
- Result count

### 3.9 State Management

**Context: SettingsProvider**

```typescript
interface Settings {
  columns: number          // 2-8
  spacing: number          // 0-24px
  showHoverInfo: boolean   // Show title on hover
  theme: 'light' | 'dark' | 'system'
}
```

**Data Fetching:**

- Server Components for initial data
- Server Actions for pagination
- SWR for client-side search

### 3.10 Interactions & Animations

| Action | Animation |
| --- | --- |
| Block card hover | Scale 1.02, shadow, overlay fade |
| Modal open | Scale from 90% + backdrop fade |
| Modal close | Scale to 95% + fade out |
| Image load | Blur placeholder → sharp (500ms) |
| Infinite scroll | Fade in new items |
| Search expand | Slide out width (300ms) |
| Color picker | Popover scale + fade |
| Page transition | Fade (200ms) |
| Skeleton | Shimmer gradient |

---

## Part 4: Shared Design System

### 4.1 shadcn Components to Install

**Both Projects:**

```bash
npx shadcn@latest add button card input label badge dialog 
npx shadcn@latest add dropdown-menu popover tooltip scroll-area
npx shadcn@latest add separator skeleton avatar tabs table
npx shadcn@latest add command sheet sidebar breadcrumb
npx shadcn@latest add toggle toggle-group switch checkbox
npx shadcn@latest add select textarea toast sonner
npx shadcn@latest add progress alert alert-dialog
```

**Engine UI Additional:**

```bash
npx shadcn@latest add data-table (custom) chart
```

### 4.2 Theme Configuration

**CSS Variables (globals.css):**

```css
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;
}

.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  /* ... dark variants */
}
```

### 4.3 Typography

**Font Stack:**

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Scale:**

| Element | Size | Weight |
| --- | --- | --- |
| h1 | 2.25rem (36px) | 700 |
| h2 | 1.875rem (30px) | 600 |
| h3 | 1.5rem (24px) | 600 |
| h4 | 1.25rem (20px) | 600 |
| body | 1rem (16px) | 400 |
| small | 0.875rem (14px) | 400 |
| caption | 0.75rem (12px) | 400 |

### 4.4 Color Palette (Status Colors)

| Status | Color | Hex | Usage |
| --- | --- | --- | --- |
| Running | Emerald | #10B981 | Active jobs, success |
| Queued | Amber | #F59E0B | Pending, waiting |
| Paused | Sky | #0EA5E9 | Paused state |
| Error | Red | #EF4444 | Errors, failures |
| Completed | Zinc | #71717A | Finished, inactive |
| Stopped | Purple | #8B5CF6 | Manually stopped |

---

## Part 5: Implementation Sequence

### Phase 1: Foundation

1. Remove all existing UI files (per 1.1)
2. Initialize shadcn with Maia preset in both projects
3. Install all required components
4. Set up theme provider and globals.css
5. Configure Tailwind and PostCSS

### Phase 2: Engine UI Core

1. Create EngineShell layout with sidebar
2. Build dashboard page with stats cards
3. Implement JobsTable with filtering
4. Create JobDetail page with tabs
5. Build JobForm for creating jobs
6. Add JobControls and log streaming

### Phase 3: Engine UI Polish

1. Implement real-time updates (polling/SSE)
2. Add toast notifications
3. Build confirmation dialogs
4. Create loading skeletons
5. Add responsive mobile layout

### Phase 4: Web Frontend Core

1. Create root layout with NavHeader
2. Build MasonryGrid component
3. Implement BlockCard with hover
4. Create home page with infinite scroll
5. Build block detail modal + page
6. Implement curators page

### Phase 5: Web Frontend Polish

1. Create user profile page
2. Build search with color picker
3. Add settings panel
4. Implement responsive mobile nav
5. Add image/video optimizations
6. Create loading states

### Phase 6: Integration & Testing

1. Connect all API endpoints
2. Test real-time log streaming
3. Test infinite scroll pagination
4. Verify mobile responsiveness
5. Cross-browser testing
6. Performance optimization

---

## Verification / Definition of Done

| Step | Targets | Verification |
| --- | --- | --- |
| Phase 1 | Clean slate + shadcn init | `npm run build` passes, no old UI imports |
| Phase 2 | Engine core pages | All routes accessible, job CRUD works |
| Phase 3 | Engine polish | Real-time updates visible, toasts show |
| Phase 4 | Web core pages | Home loads blocks, modal works |
| Phase 5 | Web polish | Search works, mobile nav functional |
| Phase 6 | Full integration | E2E flow: create job → see blocks in frontend |

---

## Technical Notes

**API Integration:**

- Engine UI: Uses existing `/api/engine/*` routes
- Web Frontend: Uses existing `/api/blocks/*` and `/api/image` routes
- No API changes needed

**Authentication:**

- Engine UI: Payload session or `ENGINE_MONITOR_TOKEN`
- Web Frontend: Public (no auth required)

**Performance Targets:**

- First Contentful Paint: &lt; 1.5s
- Largest Contentful Paint: &lt; 2.5s
- Cumulative Layout Shift: &lt; 0.1
- Time to Interactive: &lt; 3s