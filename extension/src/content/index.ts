/**
 * X bookmarks content script — bootstrap (Phase 4).
 *
 * Wires the SPA route watcher to the bookmarks-page lifecycle, supplies the real
 * save controller as `onSelect`, routes extraction failures to a toast, and
 * subscribes to `chrome.storage.onChanged` so visible controls re-render without
 * a reload (PRD §26, §40, §51).
 *
 * `onSaved` is deliberately a logged no-op: the tweet is confirmed in the CSV
 * before it is invoked, and Phase 5 owns the native X unbookmark click behind it.
 */

import { DEFAULT_SETTINGS } from "../shared/constants.ts";
import { getStore, onStoreChanged } from "../shared/storage.ts";
import type { Settings, Store } from "../shared/types.ts";
import {
  refreshBookmarksPage,
  startBookmarksPage,
  stopBookmarksPage,
} from "./bookmark-page.ts";
import { createSaveController } from "./save-controller.ts";
import type { SavedTweetContext } from "./save-controller.ts";
import { watchRoute } from "./route.ts";
import { showToast } from "./toast.ts";
import { EXTRACTION_ERROR } from "./tweet-extractor.ts";

/**
 * Latest known settings. The controller only reads this through the Phase-5
 * unbookmark seam; keeping it fresh here means the toggle is never stale when
 * Phase 5 lands.
 */
let currentSettings: Settings = { ...DEFAULT_SETTINGS };

/**
 * Post-success hook — Phase 5 fills this in with the verified unbookmark click.
 * Phase 4 only records the confirmed save, and only ever calls this after a
 * `201`.
 */
function onSaved(context: SavedTweetContext): void {
  const note = currentSettings.unbookmarkAfterSave
    ? "auto-unbookmark requested (Phase 5)"
    : "auto-unbookmark disabled";
  console.info(
    `[twitter-bookmarker] saved tweet ${context.tweetId} to "${context.category.name}" at ${context.savedAt} (${note})`,
  );
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

function bootstrap(): void {
  try {
    const onSelect = createSaveController({
      settings: () => currentSettings,
      onSaved,
      onExtractionError: (_article, reason) => {
        console.warn(`[twitter-bookmarker] save aborted: ${EXTRACTION_ERROR} (${reason})`);
      },
    });

    watchRoute(
      () => {
        void startBookmarksPage({ onSelect, onExtractionError: reportExtractionError });
      },
      () => {
        stopBookmarksPage();
      },
    );

    // Keep the settings seam warm; `refreshBookmarksPage` owns categories.
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

bootstrap();
