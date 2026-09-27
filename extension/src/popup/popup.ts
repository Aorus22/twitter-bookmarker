/**
 * Popup entry point.
 *
 * Wires the three popup sections together on load:
 *   - categories (CRUD / colour / drag order),
 *   - settings (auto-unbookmark, Popover/Inline),
 *   - backend status (`GET /health`).
 *
 * Any `chrome.storage.local` change — including our own writes — rerenders the
 * two storage-backed sections, so the popup can never show stale state.
 */

import { getStore, onStoreChanged } from "../shared/storage.ts";
import type { Store } from "../shared/types.ts";
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
    const backend = initBackendStatus();

    const render = (store: Store): void => {
      categories.render(store);
      settings.render(store);
    };

    onStoreChanged(render);

    void getStore()
      .then(render)
      .catch(reportBootError);

    void backend.check();
  } catch (error) {
    reportBootError(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
