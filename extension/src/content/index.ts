/**
 * X bookmarks content script — real bootstrap (Phase 3).
 *
 * Wires the SPA route watcher to the bookmarks-page lifecycle, supplies the
 * Phase-3 organizer callback seam (a logging `onSelect`; Phase 4 replaces it),
 * and subscribes to `chrome.storage.onChanged` so visible controls re-render
 * without a reload (PRD §26, §51).
 */

import { onStoreChanged } from "../shared/storage.ts";
import type { Category } from "../shared/types.ts";
import {
  refreshBookmarksPage,
  startBookmarksPage,
  stopBookmarksPage,
} from "./bookmark-page.ts";
import type { OrganizerContext } from "./organizer.ts";
import { watchRoute } from "./route.ts";
import { EXTRACTION_ERROR } from "./tweet-extractor.ts";

/**
 * Phase-3 selection seam: only logs. Phase 4 replaces this with the save flow
 * (disable controls → `SAVE_TWEET` → saved/toast state).
 */
function onSelect(category: Category, context: OrganizerContext): void {
  console.info(
    `[twitter-bookmarker] category "${category.name}" selected for tweet ${context.tweetId} (save is Phase 4)`,
  );
}

/** Phase 3 surfaces extraction failures via the console; Phase 4 routes this to a toast. */
function onExtractionError(_article: HTMLElement, reason: string): void {
  console.warn(`[twitter-bookmarker] ${EXTRACTION_ERROR} (${reason})`);
}

function bootstrap(): void {
  try {
    watchRoute(
      () => {
        void startBookmarksPage({ onSelect, onExtractionError });
      },
      () => {
        stopBookmarksPage();
      },
    );

    onStoreChanged((store) => {
      refreshBookmarksPage(store);
    });
  } catch (error) {
    // The content script must never throw into X's page.
    console.warn("[twitter-bookmarker] bootstrap failed", error);
  }
}

bootstrap();
