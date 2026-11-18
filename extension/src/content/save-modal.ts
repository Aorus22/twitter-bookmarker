/**
 * The folder picker as a modal dialog — the web counterpart of the phone's
 * collection sheet (morphe `BookmarkerSheets`).
 *
 * Two entry points share one frame:
 *  - {@link openSaveModal} lists every collection; a pick hands the choice to
 *    the save controller. This is what an unsaved tweet's bookmark button opens.
 *  - {@link openSavedModal} is what an already-saved tweet's button opens: it
 *    names where the tweet lives, offers every *other* collection as a move
 *    target (the current one is left out — moving a bookmark to where it already
 *    is would only earn a request that changes nothing), and a remove row that
 *    confirms inline before writing, because the backend's delete is a move to
 *    its trash and the web has no restore flow either.
 *
 * Design constraints, mirroring the popover's:
 *  - mounted into `document.body`, never inside the tweet: tweet DOM is X's to
 *    re-render, and a dialog clipped by an `overflow` ancestor is a dead dialog;
 *  - inline styles only — X's CSP and its own stylesheets own the page's CSS;
 *  - at most one modal open at a time;
 *  - the theme is read from the page at open time (body background/text), so the
 *    dialog matches whichever of X's light/dim/lights-out themes is active; a
 *    page that cannot be read falls back to the dim palette.
 */

import { DEFAULT_CATEGORY_COLOR } from "../shared/constants.ts";
import type { Category } from "../shared/types.ts";
import { MODAL_ATTRIBUTE, MODAL_DIALOG_ATTRIBUTE, CATEGORY_ID_ATTRIBUTE } from "./selectors.ts";

/** Title of the unsaved-tweet picker. */
export const SAVE_MODAL_TITLE = "Save to folder";
/** Title of the saved-tweet sheet when the collection's name is unknown. */
export const SAVED_MODAL_FALLBACK_TITLE = "Saved";
/** Copy of the muted note when every other collection is already listed nowhere. */
export const NOWHERE_TO_MOVE_NOTE = "There is nowhere else to move it";
/** Copy above the confirm step of a removal. */
export const REMOVE_CONFIRM_NOTE =
    "It will not show in the gallery any more. The backend moves it to the trash rather than deleting it, so nothing the archive holds is lost.";
/** Row label that starts the remove flow. */
export const REMOVE_ROW_LABEL = "Remove from Bookmarker";
/** Confirm-step row labels. */
export const REMOVE_CONFIRM_LABEL = "Remove";
export const REMOVE_CANCEL_LABEL = "Keep";

/** The accent X's own bookmark uses, shared by the hover and the saved mark. */
export const ACCENT_BLUE = "#1d9bf0";
/** The danger red of a destructive row. */
export const DANGER_RED = "#f4212e";

/** Injectable surface (tests pass the fake document). */
export interface SaveModalDeps {
  /** Document to mount into; defaults to the global `document`. */
  document?: Document;
}

/** Everything every modal needs to know about the tweet it is about. */
export interface SaveModalBaseOptions extends SaveModalDeps {
  /** X status id of the tweet the modal is about. */
  tweetId: string;
  /** The trigger to hand focus back to on close. */
  source?: HTMLElement | undefined;
}

/** Options for {@link openSaveModal}. */
export interface SavePickerOptions extends SaveModalBaseOptions {
  /** All collections, in the backend's order. */
  categories: readonly Category[];
  /** Called once per pick, after the modal has closed. */
  onPick: (category: Category) => void;
}

/** Options for {@link openSavedModal}. */
export interface SavedModalOptions extends SaveModalBaseOptions {
  /** All collections, in the backend's order. */
  categories: readonly Category[];
  /** The slug the tweet currently lives in, or `null` when unknown. */
  savedSlug: string | null;
  /** Called once per move, after the modal has closed. */
  onMove: (category: Category) => void;
  /** Called once, after the modal has closed and the user confirmed. */
  onRemove: () => void;
}

interface ThemePalette {
  /** True when the page is dark; picks the fallback palette and row hover. */
  dark: boolean;
  /** X's scrim colour. */
  scrim: string;
  /** The dialog surface, read from the page body. */
  surface: string;
  /** Primary text, read from the page body. */
  text: string;
  /** Muted text (notes, secondary rows). */
  secondary: string;
  /** Hairline borders inside the dialog. */
  border: string;
}

/** X's own scrim colour, shared by both palettes. */
const LIGHT_SCRIM = "rgba(91, 112, 131, 0.4)";

const LIGHT_PALETTE: ThemePalette = {
  dark: false,
  scrim: LIGHT_SCRIM,
  surface: "#ffffff",
  text: "#0f1419",
  secondary: "#536471",
  border: "rgba(0, 0, 0, 0.08)",
};

/**
 * The palette used when the page's own colours cannot be read — X's dim theme
 * values. Exported so tests can name the fallback instead of guessing it.
 */
export const DARK_PALETTE: ThemePalette = {
  dark: true,
  scrim: LIGHT_SCRIM,
  surface: "#15202b",
  text: "#eff3f4",
  secondary: "#71767b",
  border: "rgba(255, 255, 255, 0.08)",
};

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → the channels, or `null` when unreadable. */
function parseRgb(value: string): [number, number, number] | null {
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Perceived luminance 0–255 of an rgb triple. */
function luminance(rgb: readonly number[]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Read the active theme off the page body. X paints its canvas colour on
 * `body`, so the dialog borrows exactly that surface and text colour — light,
 * dim and lights-out all come out right without knowing X's class names.
 */
function themeFor(doc: Document): ThemePalette {
  const view = doc.defaultView;
  const body = doc.body ?? doc.documentElement;
  if (!view || typeof view.getComputedStyle !== "function" || !body) return DARK_PALETTE;

  const styles = view.getComputedStyle(body);
  const background = parseRgb(styles.backgroundColor ?? "");
  const text = parseRgb(styles.color ?? "");
  if (!background) return DARK_PALETTE;

  const dark = luminance(background) < 128;
  return {
    dark,
    scrim: LIGHT_PALETTE.scrim,
    surface: formatRgb(background),
    text: text ? formatRgb(text) : dark ? DARK_PALETTE.text : LIGHT_PALETTE.text,
    secondary: dark ? DARK_PALETTE.secondary : LIGHT_PALETTE.secondary,
    border: dark ? DARK_PALETTE.border : LIGHT_PALETTE.border,
  };
}

function formatRgb(channels: readonly number[]): string {
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/** Categories ordered by `order` (stable), never mutating the input. */
function orderedCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => a.order - b.order);
}

/** The display name of a collection slug, or `null` when the list does not hold it. */
export function nameForSlug(categories: readonly Category[], slug: string | null): string | null {
  if (!slug) return null;
  return categories.find((category) => category.slug === slug)?.name ?? null;
}

/* -------------------------------------------------------------------------- */
/* Singleton state                                                            */
/* -------------------------------------------------------------------------- */

interface OpenModal {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  doc: Document;
  tweetId: string;
  /** The trigger to hand focus back to on close, if the opener passed one. */
  source: HTMLElement | undefined;
  onDocumentClick: (event: Event) => void;
  onDocumentKeydown: (event: Event) => void;
}

/** At most one modal is ever open, like the popover. */
let openModal: OpenModal | null = null;

/** True when `tweetId` currently owns the open modal. */
export function isSaveModalOpenFor(tweetId: string): boolean {
  return openModal?.tweetId === tweetId;
}

/** Close the (single) open modal, if any. Safe to call at any time. */
export function closeSaveModal(): void {
  const current = openModal;
  if (!current) return;
  openModal = null;
  current.doc.removeEventListener("click", current.onDocumentClick, true);
  current.doc.removeEventListener("keydown", current.onDocumentKeydown);
  current.backdrop.remove();
  if (current.source && typeof current.source.focus === "function") current.source.focus();
}

/** Close the modal if its backdrop left the DOM (the tweet page was torn down). */
export function closeStaleSaveModal(): void {
  if (openModal && !openModal.backdrop.isConnected) closeSaveModal();
}

/** Close the modal if `tweetId`'s controls are being re-rendered or removed. */
export function closeSaveModalFor(tweetId: string): void {
  if (isSaveModalOpenFor(tweetId)) closeSaveModal();
}

/* -------------------------------------------------------------------------- */
/* Markup                                                                     */
/* -------------------------------------------------------------------------- */

function makeRowButton(doc: Document, palette: ThemePalette): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("type", "button");
  button.style.display = "flex";
  button.style.alignItems = "center";
  button.style.gap = "10px";
  button.style.width = "100%";
  button.style.boxSizing = "border-box";
  button.style.padding = "10px 12px";
  button.style.border = "none";
  button.style.borderRadius = "12px";
  button.style.background = "transparent";
  button.style.color = palette.text;
  button.style.font = "inherit";
  button.style.fontSize = "14px";
  button.style.lineHeight = "20px";
  button.style.textAlign = "left";
  button.style.cursor = "pointer";
  return button;
}

/** A colour dot + name button for one collection. */
function folderRow(
  doc: Document,
  category: Category,
  palette: ThemePalette,
  onPick: (category: Category) => void,
): HTMLButtonElement {
  const button = makeRowButton(doc, palette);
  button.setAttribute(CATEGORY_ID_ATTRIBUTE, category.slug);
  button.setAttribute("title", category.name);
  button.className = "twb-modal-folder";

  const dot = doc.createElement("span");
  dot.style.display = "inline-block";
  dot.style.width = "10px";
  dot.style.height = "10px";
  dot.style.borderRadius = "50%";
  dot.style.flex = "0 0 auto";
  dot.style.backgroundColor = category.color || DEFAULT_CATEGORY_COLOR;

  const label = doc.createElement("span");
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  label.textContent = category.name;

  button.append(dot, label);
  button.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSaveModal();
    onPick(category);
  });
  return button;
}

/** A borderless text row for notes ("There is nowhere else to move it"). */
function noteRow(doc: Document, palette: ThemePalette, text: string): HTMLElement {
  const note = doc.createElement("div");
  note.style.padding = "10px 12px";
  note.style.color = palette.secondary;
  note.style.fontSize = "14px";
  note.style.lineHeight = "20px";
  note.textContent = text;
  return note;
}

/** The dialog's ✕ close button. */
function closeButton(doc: Document, palette: ThemePalette, onClose: () => void): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", "Close");
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "28px";
  button.style.height = "28px";
  button.style.padding = "0";
  button.style.border = "none";
  button.style.borderRadius = "50%";
  button.style.background = "transparent";
  button.style.color = palette.secondary;
  button.style.cursor = "pointer";

  const namespace = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(namespace, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(namespace, "path");
  path.setAttribute("d", "M5 5l14 14M19 5L5 19");
  svg.appendChild(path);
  button.appendChild(svg);

  button.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  });
  return button;
}

interface ModalFrame {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  title: HTMLElement;
  listBox: HTMLElement;
}

/**
 * Build and mount the shared frame: backdrop, dialog, header with title and ✕,
 * and the box the variant fills with rows. Returns the parts and the close
 * function; listeners land on `doc` exactly like the popover's.
 */
function mountFrame(
  options: SaveModalBaseOptions,
  palette: ThemePalette,
  titleText: string,
): ModalFrame {
  closeSaveModal();

  const doc = options.document ?? document;
  const host = doc.body ?? doc.documentElement;
  if (!host) throw new Error("no_document_body");

  const backdrop = doc.createElement("div");
  backdrop.setAttribute(MODAL_ATTRIBUTE, "true");
  backdrop.className = "twb-modal-backdrop";
  backdrop.style.position = "fixed";
  backdrop.style.inset = "0";
  backdrop.style.zIndex = "2147483000";
  backdrop.style.display = "flex";
  backdrop.style.alignItems = "center";
  backdrop.style.justifyContent = "center";
  backdrop.style.background = palette.scrim;
  backdrop.style.padding = "16px";
  backdrop.style.boxSizing = "border-box";

  const dialog = doc.createElement("div");
  dialog.setAttribute(MODAL_DIALOG_ATTRIBUTE, "true");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;
  dialog.className = "twb-modal-dialog";
  dialog.style.width = "100%";
  dialog.style.maxWidth = "320px";
  dialog.style.maxHeight = "70vh";
  dialog.style.display = "flex";
  dialog.style.flexDirection = "column";
  dialog.style.boxSizing = "border-box";
  dialog.style.padding = "12px";
  dialog.style.background = palette.surface;
  dialog.style.color = palette.text;
  dialog.style.border = `1px solid ${palette.border}`;
  dialog.style.borderRadius = "16px";
  dialog.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.35)";
  dialog.style.font = "inherit";

  const titleId = "twb-modal-title";
  dialog.setAttribute("aria-labelledby", titleId);

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "8px";
  header.style.padding = "2px 4px 10px";
  header.style.borderBottom = `1px solid ${palette.border}`;

  const title = doc.createElement("h2");
  title.id = titleId;
  title.style.margin = "0";
  title.style.fontSize = "16px";
  title.style.lineHeight = "22px";
  title.style.fontWeight = "700";
  title.style.overflow = "hidden";
  title.style.textOverflow = "ellipsis";
  title.style.whiteSpace = "nowrap";
  title.textContent = titleText;

  const close = closeButton(doc, palette, closeSaveModal);
  header.append(title, close);

  const listBox = doc.createElement("div");
  listBox.style.display = "flex";
  listBox.style.flexDirection = "column";
  listBox.style.gap = "2px";
  listBox.style.paddingTop = "8px";
  listBox.style.overflowY = "auto";

  dialog.append(header, listBox);
  backdrop.appendChild(dialog);
  host.appendChild(backdrop);

  const onDocumentClick = (event: Event): void => {
    const target = event.target as Node | null;
    if (target && dialog.contains(target)) return;
    closeSaveModal();
  };
  const onDocumentKeydown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.stopPropagation();
    closeSaveModal();
  };
  doc.addEventListener("click", onDocumentClick, true);
  doc.addEventListener("keydown", onDocumentKeydown);

  openModal = { backdrop, dialog, doc, tweetId: options.tweetId, source: options.source, onDocumentClick, onDocumentKeydown };

  // Focus the dialog for keyboard users; `closeSaveModal` hands it back. The
  // fake DOM has no `focus`, so the capability is checked, not assumed.
  if (typeof dialog.focus === "function") dialog.focus();

  return { backdrop, dialog, title, listBox };
}

/**
 * Mount the frame for `options` and return a `close` that first detaches the
 * listeners, so a variant's own close path cannot leave them behind.
 */
function openFrame(
  options: SaveModalBaseOptions,
  titleText: string,
): { frame: ModalFrame; palette: ThemePalette } {
  const palette = themeFor(options.document ?? document);
  const frame = mountFrame(options, palette, titleText);
  return { frame, palette };
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Open the picker for an unsaved tweet: one row per collection, in the
 * backend's order. A pick closes the modal before `onPick` runs, so the save
 * controller's saving state is never hidden behind the dialog.
 */
export function openSaveModal(options: SavePickerOptions): void {
  const doc = options.document ?? document;
  const { frame, palette } = openFrame(options, SAVE_MODAL_TITLE);
  const categories = orderedCategories(options.categories);

  if (categories.length === 0) {
    frame.listBox.appendChild(noteRow(doc, palette, "No folders yet"));
    return;
  }

  for (const category of categories) {
    // `folderRow` closes the modal before calling back, so the pick surfaces
    // the save controller's state on the tweet, not behind the dialog.
    frame.listBox.appendChild(folderRow(doc, category, palette, options.onPick));
  }
}

/**
 * Open the sheet for an already-saved tweet: where it lives, every other
 * collection as a move target, and a remove row that confirms inline.
 *
 * The move and remove callbacks run only after the modal has closed, so a
 * state change they trigger re-renders a tweet that is not behind the dialog.
 */
export function openSavedModal(options: SavedModalOptions): void {
  const doc = options.document ?? document;
  const categories = orderedCategories(options.categories);
  const currentName = nameForSlug(options.categories, options.savedSlug);
  const title = currentName ? `Saved in ${currentName}` : SAVED_MODAL_FALLBACK_TITLE;

  const { frame, palette } = openFrame(options, title);
  const targets = categories.filter((category) => category.slug !== options.savedSlug);

  const renderList = (): void => {
    frame.listBox.replaceChildren();

    if (targets.length === 0) {
      frame.listBox.appendChild(noteRow(doc, palette, NOWHERE_TO_MOVE_NOTE));
    } else {
      const heading = noteRow(doc, palette, "Move to…");
      heading.style.paddingBottom = "4px";
      heading.style.fontSize = "12px";
      frame.listBox.appendChild(heading);
      for (const category of targets) {
        frame.listBox.appendChild(folderRow(doc, category, palette, options.onMove));
      }
    }

    const remove = makeRowButton(doc, palette);
    remove.className = "twb-modal-remove";
    remove.style.color = DANGER_RED;
    remove.style.fontWeight = "600";
    remove.textContent = REMOVE_ROW_LABEL;
    remove.addEventListener("click", (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      renderConfirm();
    });
    frame.listBox.appendChild(remove);
  };

  const renderConfirm = (): void => {
    frame.listBox.replaceChildren();
    frame.listBox.appendChild(noteRow(doc, palette, REMOVE_CONFIRM_NOTE));

    const confirm = makeRowButton(doc, palette);
    confirm.className = "twb-modal-remove-confirm";
    confirm.style.background = DANGER_RED;
    confirm.style.color = "#ffffff";
    confirm.style.fontWeight = "700";
    confirm.style.justifyContent = "center";
    confirm.textContent = REMOVE_CONFIRM_LABEL;
    confirm.addEventListener("click", (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      closeSaveModal();
      options.onRemove();
    });

    const cancel = makeRowButton(doc, palette);
    cancel.className = "twb-modal-remove-cancel";
    cancel.style.justifyContent = "center";
    cancel.textContent = REMOVE_CANCEL_LABEL;
    cancel.addEventListener("click", (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      renderList();
    });

    frame.listBox.append(confirm, cancel);
  };

  renderList();
}
