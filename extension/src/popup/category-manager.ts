/**
 * Popup — Categories section.
 *
 * Categories live in the backend now, so this section is a *client* of
 * `/v1/collections`: it lists what the cache holds, and every change is one
 * message to the service worker, which performs the HTTP request and refreshes the
 * cache. There is no delete, by design: a collection holds bookmarks that would
 * have to go somewhere, and the resource is easier to explain without a second
 * destructive verb.
 *
 * The list itself is never assembled here. After a successful change the worker
 * writes the new list to `chrome.storage.local`, which fires a store change and
 * re-renders from the authoritative answer — so a rename that changed a slug, or a
 * reorder that renumbered everything, cannot leave the popup showing a list the
 * backend does not have.
 */

import { CATEGORY_COLOR_PALETTE, DEFAULT_CATEGORY_COLOR } from "../shared/constants.ts";
import { collectionsErrorMessage, displayColor, moveSlug, reorderCategories } from "../shared/collections.ts";
import { sendExtensionMessage } from "../shared/messages.ts";
import type { CollectionsResponse } from "../shared/messages.ts";
import type { Category, Store } from "../shared/types.ts";

export interface CategoryManager {
  /** Render the list for a normalized store. */
  render(store: Store): void;
}

function requireEl<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`popup markup is missing #${id}`);
  return element as unknown as T;
}

export function initCategoryManager(): CategoryManager {
  const list = requireEl<HTMLUListElement>("category-list");
  const empty = requireEl<HTMLParagraphElement>("categories-empty");
  const countEl = requireEl<HTMLSpanElement>("categories-count");
  const errorEl = requireEl<HTMLParagraphElement>("category-error");
  const form = requireEl<HTMLFormElement>("add-category-form");
  const toggle = requireEl<HTMLButtonElement>("add-category-toggle");
  const nameInput = requireEl<HTMLInputElement>("add-category-name");
  const colorInput = requireEl<HTMLInputElement>("add-category-color");
  const cancelButton = requireEl<HTMLButtonElement>("add-category-cancel");
  const template = requireEl<HTMLTemplateElement>("category-row-template");

  /** Non-null while an inline rename input is open; blocks list rebuilds that would clobber it. */
  let activeRenameId: string | null = null;
  /** The row currently being dragged, if any. */
  let draggingRow: HTMLLIElement | null = null;
  /** Last rendered order, used to skip no-op reorder writes. */
  let lastOrder: string[] = [];
  /** The rows currently rendered, so an up/down nudge has the order to work from. */
  let rendered: Category[] = [];
  /** True while a request is in flight; a second change would race the first. */
  let busy = false;

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  /**
   * Send one collection message and report its outcome.
   *
   * Success is deliberately quiet: the worker has already written the new list to
   * storage, so the re-render arrives on its own. Only the two cases that render
   * nothing — a refused change, and an applied change whose refresh failed — leave
   * a message behind.
   */
  async function apply(
    message:
      | { type: "CREATE_COLLECTION"; name: string; color?: string }
      | { type: "UPDATE_COLLECTION"; slug: string; name?: string; color?: string; order?: number }
      | { type: "REORDER_COLLECTIONS"; slugs: string[] },
  ): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const response = await sendExtensionMessage<CollectionsResponse>(message);
      if (!response.ok) {
        showError(collectionsErrorMessage(response.error));
        return;
      }
      if (response.collections === null) {
        showError("Saved, but the category list could not be refreshed — reopen the popup");
        return;
      }
      clearError();
      // Render from the answer immediately as well as waiting for the storage
      // event: the two are interchangeable, and rendering here means the popup is
      // correct even if the listener is removed in a future refactor.
      renderRows(response.collections);
    } catch {
      showError(collectionsErrorMessage("backend_unavailable"));
    } finally {
      busy = false;
    }
  }

  function openAddForm(): void {
    clearError();
    form.hidden = false;
    toggle.hidden = true;
    if (colorInput.value === "") colorInput.value = DEFAULT_CATEGORY_COLOR;
    nameInput.value = "";
    nameInput.focus();
  }

  function closeAddForm(): void {
    form.hidden = true;
    toggle.hidden = false;
    nameInput.value = "";
  }

  function startRename(row: HTMLLIElement, category: Category): void {
    const nameEl = row.querySelector<HTMLSpanElement>(".category-name");
    const inputEl = row.querySelector<HTMLInputElement>(".category-name-input");
    if (!nameEl || !inputEl) return;

    activeRenameId = category.id;
    nameEl.hidden = true;
    inputEl.hidden = false;
    inputEl.value = category.name;
    inputEl.focus();
    inputEl.select();

    let settled = false;
    const finish = (commit: boolean): void => {
      if (settled) return;
      settled = true;
      activeRenameId = null;
      inputEl.hidden = true;
      nameEl.hidden = false;

      const value = inputEl.value.trim();
      if (!commit || value.length === 0 || value === category.name) return;

      void apply({ type: "UPDATE_COLLECTION", slug: category.slug, name: value });
    };

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    inputEl.addEventListener("blur", () => finish(true), { once: true });
  }

  /** Persist the order the DOM currently shows (no-op when unchanged). */
  function persistOrderFromDom(): void {
    const slugs = Array.from(list.querySelectorAll<HTMLLIElement>(".category-row"))
      .map((row) => row.dataset.categorySlug ?? "")
      .filter((slug) => slug.length > 0);

    if (slugs.length !== lastOrder.length) return;
    if (slugs.join("\u0000") === lastOrder.join("\u0000")) return;

    void apply({ type: "REORDER_COLLECTIONS", slugs });
  }

  function renderRow(category: Category, index: number, total: number): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const row = fragment.firstElementChild as HTMLLIElement | null;
    if (row === null) throw new Error("category row template is empty");

    row.dataset.categorySlug = category.slug;
    row.dataset.categoryId = category.id;
    row.draggable = true;
    row.classList.add("category-row");

    const colorEl = row.querySelector<HTMLInputElement>(".category-color");
    const nameEl = row.querySelector<HTMLSpanElement>(".category-name");
    const slugEl = row.querySelector<HTMLSpanElement>(".category-slug");
    const renameButton = row.querySelector<HTMLButtonElement>(".category-rename");
    const upButton = row.querySelector<HTMLButtonElement>(".category-up");
    const downButton = row.querySelector<HTMLButtonElement>(".category-down");

    if (colorEl) {
      colorEl.value = displayColor(category.color);
      colorEl.setAttribute("aria-label", `Color for ${category.name}`);
      colorEl.addEventListener("change", () => {
        void apply({ type: "UPDATE_COLLECTION", slug: category.slug, color: colorEl.value });
      });
    }

    if (nameEl) nameEl.textContent = category.name;
    if (slugEl) {
      slugEl.textContent = `\u2192 ${category.slug}`;
      slugEl.title = category.slug;
    }

    if (renameButton) {
      renameButton.setAttribute("aria-label", `Rename ${category.name}`);
      renameButton.addEventListener("click", () => startRename(row, category));
    }

    // Explicit nudges beside drag-and-drop: dragging inside a popup is fiddly, and
    // the order is a backend value both clients have to honour, so it needs a
    // control that cannot mis-drop.
    if (upButton) {
      upButton.disabled = index === 0;
      upButton.setAttribute("aria-label", `Move ${category.name} up`);
      upButton.addEventListener("click", () => {
        void apply({ type: "REORDER_COLLECTIONS", slugs: moveSlug(rendered, category.slug, -1) });
      });
    }
    if (downButton) {
      downButton.disabled = index === total - 1;
      downButton.setAttribute("aria-label", `Move ${category.name} down`);
      downButton.addEventListener("click", () => {
        void apply({ type: "REORDER_COLLECTIONS", slugs: moveSlug(rendered, category.slug, 1) });
      });
    }

    row.addEventListener("dragstart", (event) => {
      draggingRow = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", category.slug);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragover", (event) => {
      if (draggingRow === null || draggingRow === row) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const insertAfter = event.clientY > rect.top + rect.height / 2;
      list.insertBefore(draggingRow, insertAfter ? row.nextElementSibling : row);
      // The optimistic list has to follow the DOM, or an up/down nudge afterwards
      // would reorder from a stale snapshot.
      rendered = reorderCategories(rendered, Array.from(list.querySelectorAll<HTMLLIElement>(".category-row"))
        .map((entry) => entry.dataset.categorySlug ?? "")
        .filter((slug) => slug.length > 0));
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      draggingRow = null;
      persistOrderFromDom();
    });

    return row;
  }

  function renderRows(categories: Category[]): void {
    rendered = categories;
    lastOrder = categories.map((category) => category.slug);
    empty.hidden = categories.length > 0;

    // The chip mirrors the gallery's "4 collections" count. `aria-label` carries
    // the unit, since the visible text is the bare number.
    const total = categories.length;
    countEl.textContent = String(total);
    countEl.setAttribute("aria-label", `${total} ${total === 1 ? "category" : "categories"}`);

    // Never destroy an open rename input on an unrelated storage change.
    if (activeRenameId !== null) return;

    list.replaceChildren(...categories.map((category, index) => renderRow(category, index, total)));
  }

  toggle.addEventListener("click", openAddForm);
  cancelButton.addEventListener("click", closeAddForm);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (name.length === 0) {
      showError("Category name is required");
      nameInput.focus();
      return;
    }
    void apply({ type: "CREATE_COLLECTION", name, color: colorInput.value }).then(() => {
      if (errorEl.hidden) closeAddForm();
    });
  });

  // Populate the add form's colour picker from the shared palette's first entry.
  colorInput.value = CATEGORY_COLOR_PALETTE[0] ?? DEFAULT_CATEGORY_COLOR;

  function render(store: Store): void {
    renderRows(store.categories);
  }

  return { render };
}
