/**
 * Popup entry point.
 *
 * Wires the four popup sections together on load:
 *   - categories (list / add / rename / colour / order, all backend calls),
 *   - settings (auto-unbookmark, Popover/Inline),
 *   - backend target (Localhost / Custom URL),
 *   - backend status (`GET /health`).
 *
 * Any `chrome.storage.local` change — including our own writes — rerenders the
 * storage-backed sections, so the popup can never show stale state. The health
 * probe runs whenever the *resolved* backend address changes, so a custom URL
 * takes effect the moment it is saved.
 *
 * The category list is rendered from the cache first, then refreshed if it is
 * stale; the refresh reaches this popup as a storage change, which is the same path
 * a change made from another window takes.
 */

import { refreshCollectionsIfStale } from "../shared/collections-sync.ts";
import { resolveBackendBaseUrl } from "../shared/backend-url.ts";
import { resolveBackendToken } from "../shared/backend-token.ts";
import { getStore, onStoreChanged } from "../shared/storage.ts";
import type { Store } from "../shared/types.ts";
import { initBackendSettings } from "./backend-settings.ts";
import { initBackendStatus } from "./backend-status.ts";
import { initCategoryManager } from "./category-manager.ts";
import { initSettings } from "./settings.ts";

function reportBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Failed to open the popup";
  const errorEl = document.getElementById("category-error");
  if (errorEl instanceof HTMLParagraphElement) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  } else {
    console.error("[twitter-bookmarker] popup failed to initialize", error);
  }
}

function bootstrap(): void {
  try {
    const categories = initCategoryManager();
    const settings = initSettings();
    const backendSettings = initBackendSettings();
    const backend = initBackendStatus();

    /**
     * The target the last probe used; `null` until the first render. The token is
     * part of the key: saving a new one has to re-probe, or the status would keep
     * showing the verdict of the credential that was just replaced.
     */
    let probedTarget: string | null = null;

    const render = (store: Store): void => {
      categories.render(store);
      settings.render(store);
      backendSettings.render(store);
      backend.render(store);

      const target = `${resolveBackendBaseUrl(store.settings)}\u0000${resolveBackendToken(store.settings)}`;
      if (target === probedTarget) return;
      probedTarget = target;
      void backend.check();
    };

    onStoreChanged(render);

    void getStore()
      .then(render)
      .catch(reportBootError);

    // The list renders from the cache above; this only fills the gap when the cache
    // is empty or old, and it never blocks the first paint.
    void refreshCollectionsIfStale().catch(reportBootError);
  } catch (error) {
    reportBootError(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
