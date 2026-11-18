/**
 * Popup — settings controls (PRD §43, §50).
 *
 * Binds the auto-unbookmark switch and the Popover/Inline segmented control to
 * `shared/storage.ts`. Defaults (`false` / `popover`) come from the storage
 * module when nothing has been persisted yet.
 */

import { setSettings } from "../shared/storage.ts";
import type { DisplayMode, Settings, Store, WatcherMode } from "../shared/types.ts";

export interface SettingsPanel {
  /** Push persisted values into the controls without re-triggering a write. */
  render(store: Store): void;
}

function requireEl<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`popup markup is missing #${id}`);
  return element as unknown as T;
}

export function initSettings(): SettingsPanel {
  const toggle = requireEl<HTMLInputElement>("setting-unbookmark");
  const watcherToggle = requireEl<HTMLInputElement>("setting-auto-unbookmark-saved");
  const watcherMode = requireEl<HTMLDivElement>("watcher-mode");
  const watcherModeOptions = Array.from(watcherMode.querySelectorAll<HTMLButtonElement>(".segmented-option"));
  const segmented = requireEl<HTMLDivElement>("display-mode");
  const options = Array.from(segmented.querySelectorAll<HTMLButtonElement>(".segmented-option"));

  /** True while `render` writes values into the DOM, so change handlers stay quiet. */
  let syncing = false;

  function applyDisplayMode(mode: DisplayMode): void {
    for (const option of options) {
      option.setAttribute("aria-checked", String(option.dataset.mode === mode));
    }
  }

  function applyWatcherMode(mode: WatcherMode): void {
    for (const option of watcherModeOptions) {
      option.setAttribute("aria-checked", String(option.dataset.watcherMode === mode));
    }
  }

  function persist(partial: Partial<Settings>): void {
    void setSettings(partial).catch(() => {
      /* The popup is transient; a failed write leaves the prior value selected. */
    });
  }

  toggle.addEventListener("change", () => {
    if (syncing) return;
    persist({ unbookmarkAfterSave: toggle.checked });
  });

  watcherToggle.addEventListener("change", () => {
    if (syncing) return;
    persist({ autoUnbookmarkSaved: watcherToggle.checked });
  });

  for (const option of watcherModeOptions) {
    option.addEventListener("click", () => {
      const mode = option.dataset.watcherMode;
      if (mode !== "visible" && mode !== "aggressive") return;
      applyWatcherMode(mode);
      if (syncing) return;
      persist({ autoUnbookmarkSavedMode: mode });
    });
  }

  for (const option of options) {
    option.addEventListener("click", () => {
      const mode = option.dataset.mode;
      if (mode !== "popover" && mode !== "inline") return;
      applyDisplayMode(mode);
      if (syncing) return;
      persist({ displayMode: mode });
    });
  }

  function render(store: Store): void {
    syncing = true;
    toggle.checked = store.settings.unbookmarkAfterSave;
    watcherToggle.checked = store.settings.autoUnbookmarkSaved;
    applyWatcherMode(store.settings.autoUnbookmarkSavedMode);
    applyDisplayMode(store.settings.displayMode);
    syncing = false;
  }

  return { render };
}
