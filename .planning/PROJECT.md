# Twitter Bookmarker

## What This Is

Twitter Bookmarker is a Chrome Extension (Manifest V3) plus a small local Go HTTP server that lets a single user categorize tweets on `https://x.com/i/bookmarks`. Clicking a category on a bookmarked tweet extracts the tweet metadata and appends it to a per-category CSV file under `~/.twitter-bookmarker/`. Optionally, the tweet is removed from X Bookmarks after the CSV write is confirmed.

Phase 2 adds a **local web gallery**: the same Go server also serves a read-only web app that turns every CSV into a browsable, searchable, filterable Pinterest-style media gallery. The extension still does the collecting; CSV is still the source of truth; the gallery never writes.

## Core Value

A categorized tweet is durably persisted to CSV before anything else happens — CSV is the source of truth, and nothing is ever unbookmarked from X before the CSV write succeeds. The gallery is a pure projection of that CSV and may never become a second source of truth.

## Requirements

### Validated

Shipped and verified in v1.0 (58/58 requirements, audit passed 2026-09-27). Do not re-implement or regress:

- [x] Local Go backend with loopback-only HTTP API and CSV persistence (`/health`, `/v1/index`, `POST /v1/bookmarks`)
- [x] Chrome MV3 extension popup for category CRUD, colors, ordering, and settings
- [x] Content script that detects `/i/bookmarks` tweets and injects organizer UI
- [x] Save flow: content script → service worker → backend → CSV
- [x] Optional auto-unbookmark after confirmed CSV success
- [x] Hardening: SPA navigation, DOM churn, duplicate races, index recovery
- [x] Media URLs captured per bookmark and stored in the `media` CSV column (JSON array)
- [x] `TWITTER_BOOKMARKER_DIR` relocates the storage directory
- [x] Go test suite (`-race`) + extension Node test suite + Makefile build/test/lint

### Validated in v2.0 (Local Web Gallery)

Shipped and verified in v2.0 (82/82 requirements, audit passed 2026-09-28). Do not re-implement or regress. Archive: `.planning/milestones/v2.0-REQUIREMENTS.md`.

- [x] Gallery read layer: CSV reader, collection discovery, summaries, media parsing, filter, search, sort, cursor pagination
- [x] `GET /api/gallery/collections` and `GET /api/gallery/collections/{filename}/posts` with validation, path-traversal rejection, and read-only semantics
- [x] `web/` app scaffolded with the official shadcn Vite CLI (Vite + React + TypeScript), routing, theme, Vite `/api` proxy, typed API client
- [x] Gallery homepage: collection cards with cover collage, name, post/media counts, last bookmarked date, empty/no-media placeholders
- [x] Collection page: Pinterest-style masonry, multi-media post grids, text-only posts, full metadata, Open on X
- [x] Discovery: debounced server-side search, tweet-date and bookmarked-date filters (combinable), quick ranges, four sort modes, URL query state
- [x] Infinite scroll via IntersectionObserver with opaque cursor pagination and dedupe
- [x] Media lightbox with metadata panel, prev/next, and Escape/arrow keyboard navigation
- [x] Production: Go serves `web/dist` with API precedence over SPA fallback; Makefile targets
- [x] Hardening: broken media, malformed media JSON, malformed rows, empty/error/loading states, window-focus refetch, responsive layout, accessibility, dark/light/system theme

### Active

No active milestone. v2.0 shipped 2026-09-28 and is archived. Start the next milestone with
`$gsd-new-milestone`, which redefines requirements from a fresh PRD before planning. Tech debt
carried forward is recorded in `.planning/milestones/v2.0-MILESTONE-AUDIT.md` and listed in
`.planning/STATE.md` under Deferred Items.

### Out of Scope

Explicitly excluded by the PRDs (do not re-add):

From `PRD.md` (v1.0):

- Dashboard, search, filtering, CSV viewer/editor from the extension — not core to the categorize→CSV job
- Move tweet between categories, undo, import, export — adds state the CSVs already own
- Cloud sync, multi-device sync, authentication, accounts, remote backend — single-user local tool
- Quoted tweet text, image/video download — only parent text and media URLs are persisted
- Keyboard shortcuts, category icons, favorites, automatic/AI classification — not required for MVP
- Official Twitter/X API — the extension works off the rendered DOM only
- Support for pages other than `/i/bookmarks`, legacy `twitter.com`, or mobile browsers
- Database/queue/worker/Docker/Kubernetes infrastructure

From `PRD-2.md` (v2.0):

- Editing CSV, deleting/moving bookmarks, category management, renaming collections, syncing category names from the extension
- Authentication, accounts, multi-user, cloud hosting, cloud storage
- Downloading media, local media archiving, media proxy, video playback
- Editing tweet metadata, notes, AI tagging/search, recommendations
- Adding bookmarks from the gallery, modifying X bookmarks from the gallery
- Websockets / live streaming updates
- Any database, persistent gallery cache, or second source of truth
- Figma-only affordances with no CSV backing: collection description lines, topic/tag chips (`Terminal ×`, `Linux Tips ×`), media-type chips (`Images`/`Videos`/`Links`/`Text`), homepage hero search, and the `Explore` nav destination

## Context

- Single user, personal use, Linux + Chrome/Chromium.
- Backend runs manually (`twitter-bookmarker-server`); no systemd service, no auto-start.
- X is an SPA, so route changes and infinitely loaded timeline rows are handled with `MutationObserver`.
- X DOM structure is unstable; all selector logic is encapsulated in one extractor module.
- Category definitions and settings live only in `chrome.storage.local`; the backend never owns them.
- Collection names are derived from CSV filenames only. The backend never matches a CSV to extension category config, and never merges renamed categories.
- Existing CSV schema is fixed: `url,media,author,username,tweet_date,saved_at,text`. Phase 2 adds no CSV columns; `tweet_id` is derived from `url`.
- Timestamps are UTC/RFC3339 in storage; the web app renders them in the browser's local timezone and converts local date-range boundaries back to UTC before calling the API.
- **Design authority for the web app**: Figma file `Twitter Bookmarker — Phase 2 Gallery Mockups` (key `RAxDbIIUbz2mtNJtXXuDGQ`), page **`Gallery Mockups v2 — Editorial`** (chosen by the user over the page-1 neutral variant). Exact tokens, layout numbers, and component specs are captured in `docs/design/phase2-design-spec.md`.

## Constraints

- **Tech stack (extension)**: Chrome Extension Manifest V3, TypeScript, plain DOM APIs, no frontend framework.
- **Tech stack (backend)**: Go, `net/http`, `encoding/csv`. No third-party runtime deps beyond what v1.0 already uses.
- **Tech stack (web)**: Vite + React + TypeScript + shadcn/ui, `pnpm`, React Router, Tailwind. Scaffolded with the official shadcn CLI, not hand-rolled config.
- **Persistence**: CSV files under `~/.twitter-bookmarker/`; `index.json` is a rebuildable derived cache only. The gallery has no cache that can hide fresh data (request-scoped parsing only).
- **Security**: Backend binds `127.0.0.1` only; CSV filenames must match `^[a-z0-9][a-z0-9-]*\.csv$`; no path traversal; no absolute home paths in error bodies; no arbitrary filesystem endpoint; gallery API is strictly read-only.
- **Performance**: Backend may scan a whole CSV per request (personal dataset, local machine). The frontend must never load a whole collection at once — server-side filter/search/sort plus cursor pagination plus native image lazy loading.
- **Simplicity**: No database, no infrastructure beyond the extension + Go server + CSV + derived JSON index + built static `web/dist`.
- **Compatibility**: Existing `/health`, `/v1/index`, and `POST /v1/bookmarks` contracts cannot break. The extension is not migrated to the gallery API.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tweet Status ID as global duplicate key (not full URL) | Usernames can change; status IDs are stable | ✓ v1.0 |
| Backend never stores categories or settings | Keeps backend stateless re: user config; extension owns config | ✓ v1.0 |
| Rename changes only the extension's filename config | Old CSV data must never be lost or migrated implicitly | ✓ v1.0 |
| Delete removes the category from storage only | CSV data and global index entries must survive | ✓ v1.0 |
| CSV write is synchronous under a global write mutex | Guarantees no pending unpersisted bookmark on shutdown | ✓ v1.0 |
| Index persistence failure does not fail a save | CSV is authority; index is rebuildable derived data | ✓ v1.0 |
| `saved_at` is generated by the backend in UTC | Backend is the authority for persistence time | ✓ v1.0 |
| Unbookmark only after HTTP 201 | Protects against data loss when the CSV write fails | ✓ v1.0 |
| One CSV = one collection, named from filename; no merge on rename | CSV is the authority; implicitly merging renamed categories would invent history the data does not contain | ✓ v2.0 |
| Gallery API lives under `/api/gallery/*`, separate from `/v1/*` | Keeps the frozen extension contract untouched and lets gallery responses evolve freely | ✓ v2.0 |
| Opaque cursor pagination (sort key + tweet ID tie-breaker), never public page offsets | Stable infinite scroll while the CSV grows underneath the reader | ✓ v2.0 |
| Gallery reads current CSV state per request; no persistent cache | A bookmark saved by the extension must appear without restarting the backend | ✓ v2.0 |
| `tweet_id` derived from the canonical URL, no new CSV column | Preserves the v1.0 schema and the extension's write path | ✓ v2.0 |
| Web app built to Figma page `Gallery Mockups v2 — Editorial`, warm editorial palette, Playfair Display + Inter | User selected this direction over the page-1 neutral shadcn variant | ✓ v2.0 |
| Text-only posts render the design's typographic "quote panel" instead of a fake image placeholder | Matches the selected design; PRD §22 only says an artificial placeholder is unnecessary, and the panel keeps masonry rhythm without implying media exists | ✓ v2.0 |
| Dark-mode muted text is lightened from the mockup's `#746b72` | The mockup value is ~3:1 on the dark surface and fails PRD §67's adequate-contrast requirement | ✓ v2.0 |

## Current State

**Both milestones are shipped.** v1.0 (MVP extension + backend, 58/58 requirements) shipped 2026-09-27; v2.0 (Local Web Gallery, 82/82 requirements) shipped 2026-09-28. There is no active milestone.

The product today is one Go binary that both stores bookmarks and serves the gallery, plus the MV3 extension that writes them. `make build` produces the server binary, the loadable extension, and `web/dist`; `make run` serves everything from `127.0.0.1:43121`; `make verify` runs the HTTP, traceability, browser and extension-dist acceptance gates.

**Next milestone:** run `$gsd-new-milestone` to define fresh requirements from a new PRD; phase numbering continues at **Phase 11**. Open tech debt — two moderate landmark violations while the desktop filter Popover is open, the gradient-contrast combination axe cannot evaluate, the absence of a real screen-reader pass, and a known `--out` argument bug in the browser acceptance script — is recorded in `.planning/milestones/v2.0-MILESTONE-AUDIT.md` and in `.planning/STATE.md` under Deferred Items.

---

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-28 — milestone v2.0 (Local Web Gallery) shipped and archived; no active milestone*
