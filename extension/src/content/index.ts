/**
 * X bookmarks content script.
 *
 * Phase 2 scope: exist and bundle cleanly (iife) so `manifest.json` always
 * references a real file. Phase 3 implements route detection, the
 * `MutationObserver`, tweet discovery/extraction, and the popover/inline
 * organizer UI here, using `onStoreChanged` from `../shared/storage.ts` for live
 * rerendering (PRD §26–§33, §51).
 */

/** Phase of the roadmap that fills in this module. */
export const CONTENT_SCRIPT_PHASE = 3;
