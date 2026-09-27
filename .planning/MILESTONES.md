# Milestones

## v1.0 MVP (Shipped: 2026-09-27)

**Phases completed:** 6 phases, 16 plans, 45 tasks

**Key accomplishments:**

- Standard-library-only Go module with fixed loopback config, 0700 storage-dir bootstrap, PRD-exact domain model, structured slog logging, and a draining SIGINT/SIGTERM lifecycle.
- Safe-filename + canonical-URL validation, synchronous encoding/csv header-once append, and a rebuildable in-memory duplicate index guarded by one global mutex.
- Loopback HTTP API with strict JSON decoding and the exact 201/409/400/500 contract, wired end-to-end into a signal-draining server binary.
- Manifest V3 TypeScript scaffold with an esbuild pipeline, a single-key `chrome.storage.local` store, PRD-exact slug generation, and the storage/message APIs every later phase consumes.
- Framework-free popup Categories section: add with name+color, inline rename that visibly retargets the CSV filename, exact-copy delete confirmation, per-row color, drag-reorder, and the empty state — all persisted to `chrome.storage.local` with zero backend traffic.
- Popup settings and status layer: a timeout-guarded `GET /health` probe with Retry, persisted auto-unbookmark and Popover/Inline controls with PRD defaults, and a bootstrap that rerenders the popup from `chrome.storage.onChanged` without a reload.
- SPA route watcher (popstate + patched pushState/replaceState + 500 ms fallback), a single debounced `MutationObserver` discovery loop, and marker-first idempotent injection with a once-per-entry `Set<string>` saved index that tolerates the Phase-2 service-worker stub.
- One selector module for all X DOM coupling plus a container-scoped `TweetExtractor` that excludes quoted text, yields `text === ""` for media-only tweets, and returns a typed per-field failure instead of a partial record.
- Popover and inline organizer UI in the tweet action bar: single-open popover with ordered colour-coded categories, an exact `✓ Saved` state with no category name, a 400 ms double-click guard, and in-place rerender on category/settings/saved-set changes.
- Service worker became the extension's single backend HTTP client: typed `HEALTH_CHECK` / `GET_SAVED_INDEX` / `SAVE_TWEET` messages now drive real `GET /health`, `GET /v1/index`, and `POST /v1/bookmarks` calls with every failure normalized to `backend_unavailable` / `invalid_request` / `internal`.
- Clicking a category now runs a guarded per-tweet save state machine that disables the controls, sends one `SAVE_TWEET`, and lands on `✓ Saved` + a stacked toast for 201/409 while failures restore the controls with `Backend unavailable` / `Could not save tweet`.
- `unbookmarkTweet` clicks X's native bookmark control and only reports success when a scoped MutationObserver (or the ~2s deadline) observes `removeBookmark` → `bookmark` or the row detaching — never on the click alone.
- Auto-unbookmark is gated in the `201`-only `onSaved` hook, verified, and invariant-safe: a failed removal warns with the exact PRD §38 copy while CSV, index, and `✓ Saved` stay untouched, and the in-flight guard is released without awaiting the destructive click.
- Backend acceptance criteria §65 items 1-20 are locked by named, race-clean Go tests spanning unit, external-parser, rebuild, concurrency and real-process levels
- Extension hardening guards (resilient observer, coalescing index retry, bounded route-leave cleanup) wired into the live page lifecycle, locked by 11 new fake-DOM tests (147 total) plus an executable PRD §68 manual checklist
- Root Makefile and README ship the MVP with a reproducible `make build`/`make test`, a loud explicit `clean-storage`, and a recorded isolated-HOME smoke proving 201/409/400, strict CSV, index rebuild, and clean shutdown

---
