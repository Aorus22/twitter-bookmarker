/**
 * Popup — backend target settings (PRD §50).
 *
 * Lets the user pick between the fixed loopback backend (`Localhost`) and a
 * custom base URL (`Custom`). Picking a mode persists it immediately; the custom
 * URL is validated with `shared/backend-url.ts` and only then written, so a typo
 * can never reject every later request without explanation.
 *
 * The popup is transient and the worker re-reads the store on every message, so
 * a successful write here is what makes the new address take effect.
 */

import { normalizeBackendUrl } from "../shared/backend-url.ts";
import { setSettings } from "../shared/storage.ts";
import type { BackendMode, Settings, Store } from "../shared/types.ts";

export interface BackendSettingsPanel {
  /** Push persisted values into the controls without re-triggering a write. */
  render(store: Store): void;
}

function requireEl<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`popup markup is missing #${id}`);
  return element as unknown as T;
}

export function initBackendSettings(): BackendSettingsPanel {
  const modeGroup = requireEl<HTMLDivElement>("backend-mode");
  const modeOptions = Array.from(modeGroup.querySelectorAll<HTMLButtonElement>(".segmented-option"));
  const customForm = requireEl<HTMLDivElement>("backend-custom");
  const urlInput = requireEl<HTMLInputElement>("backend-url");
  const saveButton = requireEl<HTMLButtonElement>("backend-url-save");
  const errorEl = requireEl<HTMLParagraphElement>("backend-url-error");

  /** True while `render` writes values into the DOM, so change handlers stay quiet. */
  let syncing = false;

  function applyMode(mode: BackendMode): void {
    for (const option of modeOptions) {
      option.setAttribute("aria-checked", String(option.dataset.backend === mode));
    }
    customForm.hidden = mode !== "custom";
  }

  function showError(message: string | null): void {
    errorEl.textContent = message ?? "";
    errorEl.hidden = message === null;
  }

  function persist(partial: Partial<Settings>): void {
    void setSettings(partial)
      .then(() => {
        showError(null);
        // No explicit "apply": the storage change rerenders the popup, and
        // `popup.ts` re-probes the moment the resolved address changes.
      })
      .catch(() => {
        showError("Could not save the backend URL. Try again.");
      });
  }

  for (const option of modeOptions) {
    option.addEventListener("click", () => {
      const mode = option.dataset.backend;
      if (mode !== "localhost" && mode !== "custom") return;

      applyMode(mode);
      if (syncing) return;

      // Switching to Custom keeps whatever URL was last saved (the default is
      // the loopback address, so the field always starts valid).
      persist({ backendMode: mode });
    });
  }

  function save(): void {
    const normalized = normalizeBackendUrl(urlInput.value);
    if (normalized === null) {
      showError("Enter a valid http:// or https:// URL, e.g. http://192.168.1.10:43121");
      urlInput.focus();
      return;
    }

    // Show the normalized form the user is actually about to save.
    urlInput.value = normalized;
    persist({ backendMode: "custom", backendUrl: normalized });
  }

  saveButton.addEventListener("click", save);

  urlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    save();
  });

  urlInput.addEventListener("input", () => {
    showError(null);
  });

  function render(store: Store): void {
    syncing = true;
    applyMode(store.settings.backendMode);
    // Never overwrite a URL the user is in the middle of typing: an unrelated
    // store change (adding a category, toggling a setting) must not eat it.
    if (document.activeElement !== urlInput) urlInput.value = store.settings.backendUrl;
    showError(null);
    syncing = false;
  }

  return { render };
}
