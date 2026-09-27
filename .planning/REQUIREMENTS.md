# Requirements: Twitter Bookmarker

**Defined:** 2026-09-27
**Core Value:** CSV is the durable source of truth; nothing is unbookmarked from X before the CSV write succeeds.

## v1 Requirements

Requirements for the initial MVP. Each maps to a roadmap phase.

### Backend (Go)

- [ ] **BE-01**: Server binds only to `127.0.0.1` on a single hardcoded port constant (`43121`)
- [ ] **BE-02**: Server creates `~/.twitter-bookmarker/` (0700) automatically on startup and exits with a clear error if it cannot
- [ ] **BE-03**: `GET /health` returns `200` with `{"status":"ok"}`
- [ ] **BE-04**: `POST /v1/bookmarks` creates the category CSV with the exact header `url,author,username,tweet_date,saved_at,text`, writes the header once, and appends subsequent rows
- [ ] **BE-05**: Backend normalizes tweet URLs to canonical `https://x.com/<user>/status/<id>` (strips query and hash)
- [ ] **BE-06**: Backend extracts and validates the numeric Tweet Status ID from the URL
- [ ] **BE-07**: Backend generates `saved_at` itself in ISO 8601 UTC
- [ ] **BE-08**: Duplicate Tweet Status ID is rejected globally (across all CSVs) with `409` and no second row is appended
- [ ] **BE-09**: `GET /v1/index` returns all saved tweet IDs keyed by ID with `url`, `filename`, `saved_at`
- [ ] **BE-10**: Index is loaded when valid, and rebuilt from all CSVs when missing, malformed, or when the directory is empty
- [ ] **BE-11**: Filename is validated against `^[a-z0-9][a-z0-9-]*\.csv$`; traversal (`/`, `\`, `..`, `~`) is rejected with `400`
- [ ] **BE-12**: CSV output is valid for commas, quotes, emoji, unicode, and embedded newlines using Go `encoding/csv`
- [ ] **BE-13**: Concurrent duplicate requests cannot produce duplicate rows (global write mutex)
- [ ] **BE-14**: A CSV append that succeeded is treated as success even if `index.json` persistence fails (warning logged, in-memory index updated)
- [ ] **BE-15**: Backend logs startup, storage dir, address, index rebuild, save, duplicate, invalid request, filesystem errors, and index-persistence warnings; never logs full tweet text
- [ ] **BE-16**: In-flight requests are drained and the server shuts down cleanly on `SIGINT`/`SIGTERM`
- [ ] **BE-17**: Port-in-use and storage-directory failures exit with a clear error message
- [ ] **BE-18**: Invalid payloads (bad filename, bad URL, missing author/username, bad date, malformed JSON) return `400`; backend stores no categories or settings

### Extension Settings

- [ ] **EXT-01**: Extension persists `{version, settings:{unbookmarkAfterSave,displayMode}, categories:[{id,name,filename,color,order}]}` in `chrome.storage.local` only
- [ ] **EXT-02**: Popup shows backend connection status from `GET /health` with Connected / Disconnected (and optional Retry)
- [ ] **EXT-03**: User can add a category with name + color; extension generates stable `id`, slug `filename`, and appends `order`
- [ ] **EXT-04**: Renaming a category updates `name` and recomputes `filename` without touching, renaming, or migrating the old CSV
- [ ] **EXT-05**: Deleting a category removes it from `chrome.storage.local` only; no backend call, no file deletion
- [ ] **EXT-06**: User can change a category color; color is UI-only and never sent to the backend or written to CSV
- [ ] **EXT-07**: Popup supports drag-and-drop reorder; persisted `order` drives popup, popover, and inline button order
- [ ] **EXT-08**: User can toggle `unbookmarkAfterSave` (default `false`)
- [ ] **EXT-09**: User can choose `displayMode` `popover` | `inline` (default `popover`)
- [ ] **EXT-10**: Content script listens to `chrome.storage.onChanged` and re-renders existing controls without a tab reload
- [ ] **EXT-11**: Empty category state shows "No categories yet" + Add category in the popup and injects no organizer on tweets
- [ ] **EXT-12**: Manifest V3 requests only `storage`, host access to `x.com`, and host access to the localhost backend

### X Integration

- [ ] **XI-01**: Organizer is injected only on `https://x.com/i/bookmarks`
- [ ] **XI-02**: SPA route changes are detected without full reload; leaving `/i/bookmarks` stops injection; returning resumes it
- [ ] **XI-03**: A single `MutationObserver` discovers newly loaded tweets; the saved index is fetched once per Bookmarks page entry and lookup is O(1)
- [ ] **XI-04**: Injection is idempotent via a per-tweet marker attribute; no duplicate controls on DOM re-render
- [ ] **XI-05**: Metadata extraction is scoped to the tweet container and yields `url`, `author`, `username`, `tweet_date`, `text`, `tweet_id`
- [ ] **XI-06**: Embedded quoted-tweet text is excluded; only the top-level tweet text is persisted
- [ ] **XI-07**: Media-only tweets extract with empty `text` and remain saveable
- [ ] **XI-08**: Organizer controls render in the tweet action area near X's native action buttons (not in the page header)
- [ ] **XI-09**: Popover mode shows all categories in `order` with color indicators and closes on selection, outside click, or tweet removal
- [ ] **XI-10**: Inline mode renders all category buttons in `order`
- [ ] **XI-11**: Previously saved tweet IDs render as `✓ Saved` with no category controls
- [ ] **XI-12**: If a required field (`url`, `author`, `username`, `tweet_date`) cannot be extracted, no partial record is sent and "Could not read tweet data" is shown

### Save Integration

- [ ] **SAVE-01**: Content script sends `HEALTH_CHECK`, `GET_SAVED_INDEX`, and `SAVE_TWEET` messages to the service worker instead of calling the backend directly
- [ ] **SAVE-02**: Service worker performs all backend HTTP calls
- [ ] **SAVE-03**: During a save all organizer controls on that tweet are disabled and show "Saving..."; a second click cannot start a second request
- [ ] **SAVE-04**: `201` updates the local saved cache, replaces controls with `✓ Saved`, and shows a success toast ("Saved to <Category>")
- [ ] **SAVE-05**: Backend unreachable returns controls to a usable state, shows an error toast ("Backend unavailable"), and never unbookmarks
- [ ] **SAVE-06**: `409` adds the ID to the local cache, shows `✓ Saved` (plus optional "Already saved" info toast), does not append, and does not unbookmark
- [ ] **SAVE-07**: Lightweight in-page toast system supports success/error/warning/info states and auto-dismisses

### Auto Unbookmark

- [ ] **UNB-01**: Native X unbookmark is triggered only after a confirmed `201` from the backend
- [ ] **UNB-02**: After clicking the native bookmark control, the extension verifies the bookmark state actually changed
- [ ] **UNB-03**: A failed unbookmark shows "Saved to <Category>, but failed to remove from X bookmarks", keeps CSV + index + `✓ Saved`, and never rolls back data

### Hardening & Tests

- [ ] **TEST-01**: Go unit/integration tests cover all backend acceptance criteria (BE-01..BE-18)
- [ ] **TEST-02**: Tests cover CSV edge cases: comma, quotes, emoji, unicode, multiline text
- [ ] **TEST-03**: Tests cover index rebuild from CSV with missing and corrupted `index.json`
- [ ] **TEST-04**: A concurrency test proves parallel duplicate requests yield exactly one row
- [ ] **TEST-05**: Hardening scenarios are exercised: SPA navigation, DOM re-render, duplicate race, quoted tweets, backend downtime, index recovery
- [ ] **TEST-06**: Repository ships build tooling (Makefile / npm scripts), a README with setup + run instructions, and a manual test checklist

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

(None — MVP scope only.)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dashboard / search / filter / CSV viewer | Not needed for categorize→CSV; adds a second source of read state |
| Edit CSV / move tweet / undo | CSV is append-only authority in MVP |
| Import / export / cloud sync / multi-device | Single-user local tool |
| Authentication / accounts / remote backend | Loopback-only personal server |
| Quoted tweet text / media URLs / media download | Only parent text is persisted |
| Keyboard shortcuts / category icons / favorites | Not required for MVP |
| Automatic or AI classification | Manual categorization is the product |
| Official X API | Extension operates on the DOM |
| Pages other than `/i/bookmarks`, legacy `twitter.com`, mobile | Explicit PRD boundary |
| Database / queue / Docker / Kubernetes | Unnecessary infrastructure for a personal tool |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BE-01 | Phase 1 | Pending |
| BE-02 | Phase 1 | Pending |
| BE-03 | Phase 1 | Pending |
| BE-04 | Phase 1 | Pending |
| BE-05 | Phase 1 | Pending |
| BE-06 | Phase 1 | Pending |
| BE-07 | Phase 1 | Pending |
| BE-08 | Phase 1 | Pending |
| BE-09 | Phase 1 | Pending |
| BE-10 | Phase 1 | Pending |
| BE-11 | Phase 1 | Pending |
| BE-12 | Phase 1 | Pending |
| BE-13 | Phase 1 | Pending |
| BE-14 | Phase 1 | Pending |
| BE-15 | Phase 1 | Pending |
| BE-16 | Phase 1 | Pending |
| BE-17 | Phase 1 | Pending |
| BE-18 | Phase 1 | Pending |
| EXT-01 | Phase 2 | Pending |
| EXT-02 | Phase 2 | Pending |
| EXT-03 | Phase 2 | Pending |
| EXT-04 | Phase 2 | Pending |
| EXT-05 | Phase 2 | Pending |
| EXT-06 | Phase 2 | Pending |
| EXT-07 | Phase 2 | Pending |
| EXT-08 | Phase 2 | Pending |
| EXT-09 | Phase 2 | Pending |
| EXT-10 | Phase 2 | Pending |
| EXT-11 | Phase 2 | Pending |
| EXT-12 | Phase 2 | Pending |
| XI-01 | Phase 3 | Pending |
| XI-02 | Phase 3 | Pending |
| XI-03 | Phase 3 | Pending |
| XI-04 | Phase 3 | Pending |
| XI-05 | Phase 3 | Pending |
| XI-06 | Phase 3 | Pending |
| XI-07 | Phase 3 | Pending |
| XI-08 | Phase 3 | Pending |
| XI-09 | Phase 3 | Pending |
| XI-10 | Phase 3 | Pending |
| XI-11 | Phase 3 | Pending |
| XI-12 | Phase 3 | Pending |
| SAVE-01 | Phase 4 | Pending |
| SAVE-02 | Phase 4 | Pending |
| SAVE-03 | Phase 4 | Pending |
| SAVE-04 | Phase 4 | Pending |
| SAVE-05 | Phase 4 | Pending |
| SAVE-06 | Phase 4 | Pending |
| SAVE-07 | Phase 4 | Pending |
| UNB-01 | Phase 5 | Pending |
| UNB-02 | Phase 5 | Pending |
| UNB-03 | Phase 5 | Pending |
| TEST-01 | Phase 6 | Pending |
| TEST-02 | Phase 6 | Pending |
| TEST-03 | Phase 6 | Pending |
| TEST-04 | Phase 6 | Pending |
| TEST-05 | Phase 6 | Pending |
| TEST-06 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 58 total
- Mapped to phases: 58
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-27 from PRD.md*
