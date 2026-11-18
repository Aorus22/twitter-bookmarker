// Folder-modal tests (the bookmark surface's picker and saved sheet) against
// the fake DOM.
//
// The organizer tests cover the trigger wiring; these cover the modal module
// itself: the singleton contract, the empty states, the confirm step of a
// removal, and the theme fallback.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  DARK_PALETTE,
  NOWHERE_TO_MOVE_NOTE,
  REMOVE_ROW_LABEL,
  SAVED_MODAL_FALLBACK_TITLE,
  SAVE_MODAL_TITLE,
  closeSaveModal,
  isSaveModalOpenFor,
  openSavedModal,
  openSaveModal,
} from "../src/content/save-modal.ts";
import { createDocument } from "./helpers/fake-dom.mjs";

afterEach(() => {
  closeSaveModal();
});

const CATEGORIES = [
  { id: "linux", name: "Linux", slug: "linux", color: "#10b981", order: 1 },
  { id: "ai", name: "AI", slug: "ai", color: "#4f46e5", order: 0 },
];

function pickerOverrides() {
  return {
    tweetId: "1234567890",
    document: createDocument(),
    categories: CATEGORIES,
    onPick: () => {},
  };
}

test("the picker mounts into the given document's body with the documented structure", () => {
  const options = pickerOverrides();
  openSaveModal(options);

  const backdrop = options.document.body.querySelector("[data-twitter-bookmarker-modal]");
  assert.ok(backdrop, "the backdrop lives in document.body");
  const dialog = backdrop.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(dialog.getAttribute("aria-labelledby"), "the title is labelled for screen readers");
  assert.equal(dialog.querySelector("h2").textContent, SAVE_MODAL_TITLE);
  assert.equal(isSaveModalOpenFor("1234567890"), true);
});

test("at most one modal is ever open: a second open replaces the first", () => {
  const first = pickerOverrides();
  openSaveModal(first);
  const second = pickerOverrides();
  openSavedModal({ ...second, savedSlug: null, onMove: () => {}, onRemove: () => {} });

  assert.equal(first.document.body.querySelector("[data-twitter-bookmarker-modal]"), null,
    "the first document's modal is gone — even across documents");
  assert.ok(second.document.body.querySelector("[data-twitter-bookmarker-modal]"));
  assert.equal(isSaveModalOpenFor("1234567890"), true);
});

test("the picker follows the backend's order regardless of input order", () => {
  const options = pickerOverrides();
  openSaveModal({ ...options, categories: [...CATEGORIES].reverse() });

  const rows = options.document.body.querySelectorAll("[data-category-id]");
  assert.deepEqual(rows.map((button) => button.getAttribute("data-category-id")), ["ai", "linux"]);
});

test("a picker with no collections is a note, not an empty box", () => {
  const options = pickerOverrides();
  openSaveModal({ ...options, categories: [] });

  const dialog = options.document.body.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.querySelectorAll("[data-category-id]").length, 0);
  assert.ok(dialog.textContent.includes("No folders yet"));
});

test("a pick closes the modal before the callback runs", () => {
  const options = pickerOverrides();
  let pickedDuringCallback = null;
  openSaveModal({
    ...options,
    onPick: (category) => {
      pickedDuringCallback = category;
      // The modal must already be gone: a state change in the callback (the
      // save controller's) re-renders a tweet that is no longer behind it.
      options.document.body.querySelector("[data-twitter-bookmarker-modal]");
    },
  });

  options.document.body.querySelectorAll("[data-category-id]")[0].click();
  assert.equal(pickedDuringCallback.slug, "ai");
  assert.equal(options.document.body.querySelector("[data-twitter-bookmarker-modal]"), null);
  assert.equal(isSaveModalOpenFor("1234567890"), false);
});

test("the saved sheet with an unknown slug is generically titled and still lists moves", () => {
  const options = pickerOverrides();
  const moved = [];
  openSavedModal({
    ...options,
    savedSlug: null,
    onMove: (category) => moved.push(category),
    onRemove: () => {},
  });

  const dialog = options.document.body.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.querySelector("h2").textContent, SAVED_MODAL_FALLBACK_TITLE);
  assert.equal(dialog.textContent.includes(NOWHERE_TO_MOVE_NOTE), false, "both collections are still move targets");
  assert.deepEqual(
    dialog.querySelectorAll("[data-category-id]").map((button) => button.getAttribute("data-category-id")),
    ["ai", "linux"],
  );

  dialog.querySelectorAll("[data-category-id]")[0].click();
  assert.equal(moved.length, 1);
  assert.equal(moved[0].slug, "ai");
});

test("the nowhere-to-move note appears when every collection is the current one", () => {
  const options = pickerOverrides();
  openSavedModal({
    ...options,
    categories: [{ id: "linux", name: "Linux", slug: "linux", color: "#10b981", order: 0 }],
    savedSlug: "linux",
    onMove: () => {},
    onRemove: () => {},
  });

  const dialog = options.document.body.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.querySelectorAll("[data-category-id]").length, 0);
  assert.ok(dialog.textContent.includes(NOWHERE_TO_MOVE_NOTE));
});

test("the remove row's first click only confirms; Keep returns to the list", () => {
  const options = pickerOverrides();
  let removals = 0;
  openSavedModal({ ...options, savedSlug: "linux", onMove: () => {}, onRemove: () => { removals += 1; } });

  const dialog = options.document.body.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.querySelector("h2").textContent, "Saved in Linux");

  dialog.querySelector(".twb-modal-remove").click();
  assert.equal(removals, 0, "the first click is the confirmation step, not the removal");

  dialog.querySelector(".twb-modal-remove-cancel").click();
  assert.ok(dialog.querySelector(".twb-modal-remove"), "Keep re-renders the list");
  assert.equal(dialog.textContent.includes(REMOVE_ROW_LABEL), true);

  dialog.querySelector(".twb-modal-remove").click();
  dialog.querySelector(".twb-modal-remove-confirm").click();
  assert.equal(removals, 1);
});

test("an unreadable theme falls back to the dim palette", () => {
  // The fake DOM's getComputedStyle reports nothing, so the modal must pick a
  // usable palette rather than paint `undefined` everywhere.
  const options = pickerOverrides();
  openSaveModal(options);

  const dialog = options.document.body.querySelector("[data-twitter-bookmarker-modal-dialog]");
  assert.equal(dialog.style.background, DARK_PALETTE.surface);
  assert.equal(dialog.style.color, DARK_PALETTE.text);
});
