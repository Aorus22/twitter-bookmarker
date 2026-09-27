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

### Active (v2.0 — Local Web Gallery)

Derived from `PRD-2.md`. See `.planning/REQUIREMENTS.md` for the REQ-ID breakdown.

- [ ] Gallery read layer: CSV reader, collection discovery, summaries, media parsing, filter, search, sort, cursor pagination
- [ ] `GET /api/gallery/collections` and `GET /api/gallery/collections/{filename}/posts` with validation, path-traversal rejection, and read-only semantics
- [ ] `web/` app scaffolded with the official shadcn Vite CLI (Vite + React + TypeScript), routing, theme, Vite `/api` proxy, typed API client
- [ ] Gallery homepage: collection cards with cover collage, name, post/media counts, last bookmarked date, empty/no-media placeholders
- [ ] Collection page: Pinterest-style masonry, multi-media post grids, text-only posts, full metadata, Open on X
- [ ] Discovery: debounced server-side search, tweet-date and bookmarked-date filters (combinable), quick ranges, four sort modes, URL query state
- [ ] Infinite scroll via IntersectionObserver with opaque cursor pagination and dedupe
- [ ] Media lightbox with metadata panel, prev/next, and Escape/arrow keyboard navigation
- [ ] Production: Go serves `web/dist` with API precedence over SPA fallback; Makefile targets
- [ ] Hardening: broken media, malformed media JSON, malformed rows, empty/error/loading states, window-focus refetch, responsive layout, accessibility, dark/light/system theme

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
| One CSV = one collection, named from filename; no merge on rename | CSV is the authority; implicitly merging renamed categories would invent history the data does not contain | — Pending |
| Gallery API lives under `/api/gallery/*`, separate from `/v1/*` | Keeps the frozen extension contract untouched and lets gallery responses evolve freely | — Pending |
| Opaque cursor pagination (sort key + tweet ID tie-breaker), never public page offsets | Stable infinite scroll while the CSV grows underneath the reader | — Pending |
| Gallery reads current CSV state per request; no persistent cache | A bookmark saved by the extension must appear without restarting the backend | — Pending |
| `tweet_id` derived from the canonical URL, no new CSV column | Preserves the v1.0 schema and the extension's write path | — Pending |
| Web app built to Figma page `Gallery Mockups v2 — Editorial`, warm editorial palette, Playfair Display + Inter | User selected this direction over the page-1 neutral shadcn variant | — Pending |
| Text-only posts render the design's typographic "quote panel" instead of a fake image placeholder | Matches the selected design; PRD §22 only says an artificial placeholder is unnecessary, and the panel keeps masonry rhythm without implying media exists | — Pending |
| Dark-mode muted text is lightened from the mockup's `#746b72` | The mockup value is ~3:1 on the dark surface and fails PRD §67's adequate-contrast requirement | — Pending |

## Current Milestone: v2.0 Local Web Gallery

**Goal:** Turn the CSV archive into a read-only local visual gallery — the Go backend gains a gallery read layer and `/api/gallery/*` API, a new `web/` Vite + React + TypeScript + shadcn app renders a Pinterest-style browsing experience, and production serves the built app from the same single Go process.

**Scope:** `PRD-2.md` §85 implementation order, expressed as 10 phases: 2.1 read layer → 2.2 HTTP API → 2.3 web scaffold → 2.4 homepage → 2.5 collection gallery → 2.6 discovery tools → 2.7 infinite scroll → 2.8 lightbox → 2.9 production serving → 2.10 hardening.

**Done when:** every PRD-2 §80 backend criterion, §81 web criterion, and the §82 integration scenario pass, with `go test ./... -race` and the web build/typecheck green.

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
*Last updated: 2026-09-27 — milestone v2.0 (Local Web Gallery) started from PRD-2.md*
