/**
 * X content script — bootstrap (Phase 4 + Phase 5, plus the general-page button).
 *
 * Wires the SPA route watcher to the tweet-page lifecycle, supplies the real save
 * controller as `onSelect`, routes extraction failures to a toast, and subscribes
 * to `chrome.storage.onChanged` so visible controls re-render without a reload
 * (PRD §26, §40, §51).
 *
 * The route decides *which* button is injected, not whether the lifecycle runs: on
 * the bookmarks timeline it is the organizer for a tweet X already holds, and on
 * every other page it is our own bookmark button — an icon inside X's action bar,
 * the web counterpart of the phone's action-bar button. The icon's tap opens the
 * folder modal (or, for a tweet already in the archive, the saved sheet with move
 * and remove); both surfaces pick from the same backend list and save through the
 * same controller.
 *
 * `onSaved` is the one place auto-unbookmark lives (PRD §37, §38). It is invoked
 * by the save controller only after a confirmed `201`, gated on
 * `settings.unbookmarkAfterSave`, and never rolls back a confirmed save. It applies
 * on both surfaces, which is consistent: `unbookmarkTweet` only clicks a control
 * that is currently *bookmarked*, so a tweet that was never in X's list is left
 * alone.
 */

import { refreshCollectionsIfStale } from "../shared/collections-sync.ts";
import { DEFAULT_SETTINGS } from "../shared/constants.ts";
import { sendExtensionMessage } from "../shared/messages.ts";
import type { MoveBookmarkResponse, RemoveBookmarkResponse } from "../shared/messages.ts";
import { getStore, onStoreChanged } from "../shared/storage.ts";
import type { Category, Settings, Store } from "../shared/types.ts";
import {
  markTweetMoved,
  markTweetUnsaved,
  refreshBookmarksPage,
  refreshSavedIndexIfStale,
  startBookmarksPage,
  stopBookmarksPage,
} from "./bookmark-page.ts";
import { BACKEND_UNAVAILABLE_TOAST, createSaveController } from "./save-controller.ts";
import type { SavedTweetContext } from "./save-controller.ts";
import { tweetPageMode, watchRouteKey } from "./route.ts";
import { showToast } from "./toast.ts";
import type { ToastKind } from "./toast.ts";
import { EXTRACTION_ERROR } from "./tweet-extractor.ts";
import { unbookmarkTweet } from "./unbookmark.ts";
import type { UnbookmarkResult } from "./unbookmark.ts";

/**
 * Latest known settings. Kept fresh here so the `unbookmarkAfterSave` gate is
 * never stale when the user flips the toggle.
 */
let currentSettings: Settings = { ...DEFAULT_SETTINGS };

/** Warning copy when the save succeeded but X still holds the bookmark (PRD §38). */
export function unbookmarkFailedToast(categoryName: string): string {
  return `Saved to ${categoryName}, but failed to remove from X bookmarks`;
}

/** Success copy for a confirmed move. */
export function movedToast(categoryName: string): string {
  return `Moved to ${categoryName}`;
}

/** Success copy for a confirmed removal (the row is in the backend's trash). */
export const REMOVED_TOAST = "Removed from Bookmarker";
/** Error copy for a failed move. */
export const MOVE_FAILED_TOAST = "Could not move tweet";
/** Error copy for a failed removal. */
export const REMOVE_FAILED_TOAST = "Could not remove tweet";

/** Dependencies for {@link createSavedHook}; injected so the gate is unit-testable. */
export interface SavedHookDeps {
  /** Reads the live settings at click resolution time. */
  settings: () => Settings;
  /** The verified native unbookmark; defaults to {@link unbookmarkTweet} in wiring. */
  unbookmark: (article: HTMLElement) => Promise<UnbookmarkResult>;
  /** Toast surface for the warning copy. */
  toast: (kind: ToastKind, message: string) => void;
  /** Diagnostic sink for an unexpected verification throw. */
  onVerificationError?: (error: unknown) => void;
}

/**
 * Build the post-success hook: the only auto-unbookmark entry point (PRD §37).
 *
 * The gate is deliberately first: with `unbookmarkAfterSave === false` the
 * native bookmark control is never queried, observed, or clicked (UNB-01).
 * When enabled, a `"failed"` verification or an unexpected throw emits the
 * warning toast and leaves the saved record and `✓ Saved` untouched (UNB-03).
 * Nothing in this hook ever rolls back or re-enables controls, and it never
 * rethrows.
 */
export function createSavedHook(deps: SavedHookDeps): (context: SavedTweetContext) => Promise<void> {
  return async (context: SavedTweetContext): Promise<void> => {
    // UNB-01 gate: setting off means zero bookmark-control interaction.
    if (!deps.settings().unbookmarkAfterSave) return;

    const warning = unbookmarkFailedToast(context.category.name);
    try {
      const outcome = await deps.unbookmark(context.article);
      // UNB-03: "removed" needs nothing further. "failed" warns and changes
      // nothing else — the save already happened and is never rolled back.
      if (outcome === "failed") deps.toast("warning", warning);
    } catch (error) {
      // A verification error must never change persisted state or escape into
      // the save controller.
      deps.onVerificationError?.(error);
      deps.toast("warning", warning);
    }
  };
}

const runSavedHook = createSavedHook({
  settings: () => currentSettings,
  unbookmark: unbookmarkTweet,
  toast: showToast,
  onVerificationError: (error) => {
    console.warn("[twitter-bookmarker] unbookmark verification threw", error);
  },
});

/**
 * Post-success hook — invoked by the save controller exactly once, only after a
 * confirmed `201` (UNB-01). The save is logged, then the gated unbookmark runs;
 * the controller does not await it.
 *
 * A confirmed `201` also proves the backend is reachable, so it is the natural
 * "backend became available" retry point for a saved-index fetch that failed at
 * page entry (PRD §54, TEST-05). The refresh is stale-gated and coalesced, so
 * the normal case costs zero extra requests.
 */
function onSaved(context: SavedTweetContext): Promise<void> {
  console.info(
    `[twitter-bookmarker] saved tweet ${context.tweetId} to "${context.category.name}" at ${context.savedAt}`,
  );
  void refreshSavedIndexIfStale();
  return runSavedHook(context);
}

/**
 * Injection-time extraction failure (reported by `bookmark-page`): surface the
 * canonical PRD §40 copy as a toast. The save-flow extraction failure is toasted
 * by the controller itself.
 */
function reportExtractionError(_article: HTMLElement, reason: string): void {
  console.warn(`[twitter-bookmarker] ${EXTRACTION_ERROR} (${reason})`);
  showToast("error", EXTRACTION_ERROR);
}

/**
 * Confirmed move — invoked by the saved modal after it has closed. The content
 * side only relays the choice and records it: the slug travels with the saved
 * mark, so the next open of the sheet names the new collection without a fetch.
 */
function onMove(category: Category, context: { tweetId: string }): void {
  void (async () => {
    try {
      const response = await sendExtensionMessage<MoveBookmarkResponse>({
        type: "MOVE_BOOKMARK",
        tweetId: context.tweetId,
        slug: category.slug,
      });
      if (response.ok) {
        markTweetMoved(context.tweetId, category.slug);
        showToast("success", movedToast(category.name));
        return;
      }
      showToast(
        "error",
        response.error === "backend_unavailable" ? BACKEND_UNAVAILABLE_TOAST : MOVE_FAILED_TOAST,
      );
    } catch {
      // A thrown `sendExtensionMessage` means the worker/channel is gone.
      showToast("error", BACKEND_UNAVAILABLE_TOAST);
    }
  })();
}

/**
 * Confirmed removal — the tweet drops its saved mark in the same breath, so the
 * icon returns to the outline the moment the toast does.
 */
function onRemove(context: { tweetId: string }): void {
  void (async () => {
    try {
      const response = await sendExtensionMessage<RemoveBookmarkResponse>({
        type: "REMOVE_BOOKMARK",
        tweetId: context.tweetId,
      });
      if (response.ok) {
        markTweetUnsaved(context.tweetId);
        showToast("success", REMOVED_TOAST);
        return;
      }
      showToast(
        "error",
        response.error === "backend_unavailable" ? BACKEND_UNAVAILABLE_TOAST : REMOVE_FAILED_TOAST,
      );
    } catch {
      showToast("error", BACKEND_UNAVAILABLE_TOAST);
    }
  })();
}

function bootstrap(): void {
  try {
    const onSelect = createSaveController({
      settings: () => currentSettings,
      onSaved,
      onExtractionError: (_article, reason) => {
        console.warn(`[twitter-bookmarker] save aborted: ${EXTRACTION_ERROR} (${reason})`);
      },
    });

    watchRouteKey(
      (pathname) => tweetPageMode(pathname),
      (mode) => {
        // The cached list renders immediately; this fills the gap when it is empty
        // or old, and the refresh arrives back here as a storage change.
        void refreshCollectionsIfStale();
        void startBookmarksPage({
          onSelect,
          onMove,
          onRemove,
          onExtractionError: reportExtractionError,
          variant: mode === "bookmarks" ? "organize" : "bookmark",
        });
      },
      () => {
        stopBookmarksPage();
      },
    );

    // Keep the settings seam warm; `refreshBookmarksPage` owns the category list.
    void getStore()
      .then((store: Store) => {
        currentSettings = { ...store.settings };
      })
      .catch(() => {
        /* Defaults are already applied. */
      });

    onStoreChanged((store: Store) => {
      currentSettings = { ...store.settings };
      refreshBookmarksPage(store);
    });
  } catch (error) {
    // The content script must never throw into X's page.
    console.warn("[twitter-bookmarker] bootstrap failed", error);
  }
}

// Importing this module under `node --test` must not start the page lifecycle;
// the extension context always has both globals.
if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  bootstrap();
}
