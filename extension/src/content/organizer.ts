/**
 * The per-tweet organizer UI: popover and inline category controls, the
 * `✓ Saved` state, and the Phase-4 callback seam (PRD §31–§34, §51).
 *
 * `ui-injector.ts` owns placement/lifecycle; this module owns the markup inside
 * one organizer root and the popover open/close state machine.
 */

import type { Category, DisplayMode } from "../shared/types.ts";
import {
  CATEGORY_ID_ATTRIBUTE,
  CLICK_TS_ATTRIBUTE,
  COLOR_ATTRIBUTE,
  PANEL_ATTRIBUTE,
  POPOVER_OPEN_ATTRIBUTE,
  SAVED_ATTRIBUTE,
  STATE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
  closestArticle,
  queryAll,
  queryFirst,
} from "./selectors.ts";
import {
  ACCENT_BLUE,
  closeSaveModal,
  closeSaveModalFor,
  nameForSlug,
  openSavedModal,
  openSaveModal,
} from "./save-modal.ts";

/** Popover trigger label. */
export const ORGANIZE_LABEL = "Organize";
/** Popover trigger label while a save is in flight (PRD §35). */
export const SAVING_LABEL = "Saving…";
/** Popover trigger label on a general X page (not the bookmarks timeline). */
export const BOOKMARK_LABEL = "Save to…";
/** Accessible name for that trigger, which an icon alone cannot carry. */
export const BOOKMARK_ARIA_LABEL = "Save to Twitter Bookmarker";
/** Exact saved-state copy; no category name is ever shown (PRD §34, XI-11). */
export const SAVED_LABEL = "✓ Saved";
/**
 * Clicks on the same category control within this window are treated as one
 * selection, so a double-click cannot fire `onSelect` twice (PRD §64).
 */
export const CLICK_GUARD_MS = 400;

/**
 * Which surface the controls are rendered on.
 *
 * On the bookmarks timeline the controls are an *organizer* for a tweet X is
 * already holding: a pill that opens the popover (or an inline row) and a
 * `✓ Saved` state. On any other page they are our own bookmark button — an
 * icon inside X's action bar, the web counterpart of the phone's action-bar
 * button — whose tap opens the folder modal. The click guard and the saved
 * state machinery are shared, so a category picked in either place behaves
 * identically.
 */
export type OrganizerVariant = "organize" | "bookmark";

/** Identifies the tweet a control belongs to (PRD §32 callback context). */
export interface OrganizerContext {
  /** The tweet container the control lives in. */
  article: HTMLElement;
  /** X status id of that tweet. */
  tweetId: string;
  /** The control that was clicked. */
  source: HTMLElement;
}

/** Phase-4 seam supplied by the content-script bootstrap. */
export interface OrganizerCallbacks {
  /** O(1) saved-index lookup (PRD §34). */
  isSaved(tweetId: string): boolean;
  /** Called exactly once per user selection; Phase 3 logs, Phase 4 saves. */
  onSelect(category: Category, context: OrganizerContext): void;
  /**
   * The collection a saved tweet lives in, or `null` when unknown. Only the
   * bookmark surface needs it: the saved modal names the folder and leaves the
   * current one out of the move list. Absent (tests, minimal setups) the modal
   * falls back to a generic title.
   */
  savedSlugOf?(tweetId: string): string | null;
  /** Called once per confirmed move, after the saved modal has closed. */
  onMove?(category: Category, context: OrganizerContext): void;
  /** Called once per confirmed removal, after the saved modal has closed. */
  onRemove?(context: OrganizerContext): void;
  /** Called when a tweet's metadata could not be read (PRD §40). */
  onExtractionError?(article: HTMLElement, reason: string): void;
}

/** Everything needed to render one organizer root. */
export interface OrganizerRenderOptions {
  /** X status id of the tweet. */
  tweetId: string;
  /** All categories, in the backend's order. */
  categories: readonly Category[];
  /** Popover or inline rendering (PRD §32/§33). */
  displayMode: DisplayMode;
  /** When true, render `✓ Saved` and no category controls (PRD §34). */
  saved: boolean;
  /** Phase-4 callback seam. */
  callbacks: OrganizerCallbacks;
  /**
   * Trigger style. Defaults to `"organize"`, the bookmarks-timeline surface
   * (pill + popover/inline); `"bookmark"` renders the action-bar icon whose tap
   * opens the folder modal, and ignores `displayMode`.
   */
  variant?: OrganizerVariant | undefined;
}

interface OpenPopover {
  root: HTMLElement;
  trigger: HTMLElement;
  panel: HTMLElement;
  doc: Document;
  onDocumentClick: (event: Event) => void;
  onDocumentKeydown: (event: Event) => void;
}

/** At most one popover is ever open (XI-09). */
let openPopover: OpenPopover | null = null;

/** Last options used to render each root, so saved/saving can re-render in place. */
let lastOptions = new WeakMap<HTMLElement, OrganizerRenderOptions>();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Categories ordered by `order` (stable), never mutating the input. */
function orderedCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => a.order - b.order);
}

/** The trigger label for a variant: what the button says when it is idle. */
function triggerLabel(variant: OrganizerVariant | undefined): string {
  return variant === "bookmark" ? BOOKMARK_LABEL : ORGANIZE_LABEL;
}

/**
 * The bookmark glyph, drawn as inline SVG at the size of X's own action icons.
 *
 * Inline rather than an image file: the content script runs inside X's page, where
 * a `chrome-extension://` URL in an `<img>` would be blocked by X's own
 * `img-src` policy, and a data URL would be four times the size for no benefit.
 *
 * `filled` is the saved state's mark: the same shape, filled with the current
 * colour, so "already in my archive" reads at a glance — the web twin of the
 * phone's two drawables.
 */
function bookmarkGlyph(doc: Document, filled: boolean): Element {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(namespace, "svg");
  svg.setAttribute("width", "18.75");
  svg.setAttribute("height", "18.75");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", filled ? "currentColor" : "none");
  svg.setAttribute("stroke", filled ? "none" : "currentColor");
  if (!filled) {
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.flex = "0 0 auto";
  svg.style.display = "block";

  const path = doc.createElementNS(namespace, "path");
  path.setAttribute("d", "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z");
  svg.appendChild(path);
  return svg;
}

/** The tweet container for a root, falling back to its parent element. */
function articleFor(root: HTMLElement): HTMLElement {
  return closestArticle(root) ?? (root.parentElement as HTMLElement | null) ?? root;
}

function makeButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement("button") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("type", "button");
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "4px";
  button.style.maxWidth = "160px";
  button.style.padding = "2px 8px";
  button.style.margin = "0 2px";
  button.style.border = "1px solid rgba(127, 127, 127, 0.45)";
  button.style.borderRadius = "999px";
  button.style.background = "transparent";
  button.style.color = "inherit";
  button.style.font = "inherit";
  button.style.fontSize = "12px";
  button.style.lineHeight = "18px";
  button.style.cursor = "pointer";
  return button;
}

/** A colour dot + name button for one category (order/colour honoured). */
function categoryButton(
  doc: Document,
  category: Category,
  options: OrganizerRenderOptions,
  root: HTMLElement,
): HTMLButtonElement {
  const button = makeButton(doc);
  button.setAttribute(CATEGORY_ID_ATTRIBUTE, category.id);
  button.setAttribute("title", category.name);
  button.className = "twb-category";

  const dot = doc.createElement("span");
  dot.className = "twb-color-dot";
  dot.setAttribute(COLOR_ATTRIBUTE, category.color);
  dot.style.display = "inline-block";
  dot.style.width = "8px";
  dot.style.height = "8px";
  dot.style.borderRadius = "50%";
  dot.style.flex = "0 0 auto";
  dot.style.backgroundColor = category.color;

  const label = doc.createElement("span");
  label.className = "twb-category-name";
  label.textContent = category.name;
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";

  button.append(dot, label);

  button.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;

    const previous = Number(button.getAttribute(CLICK_TS_ATTRIBUTE) ?? "0");
    const now = Date.now();
    if (Number.isFinite(previous) && now - previous < CLICK_GUARD_MS) return;
    button.setAttribute(CLICK_TS_ATTRIBUTE, String(now));

    options.callbacks.onSelect(category, { article: articleFor(root), tweetId: options.tweetId, source: button });
    closeOpenPopover();
  });

  return button;
}

/** The `✓ Saved` element: no category controls, no category name (XI-11). */
function savedElement(doc: Document): HTMLElement {
  const saved = doc.createElement("span");
  saved.className = "twb-saved";
  saved.setAttribute(SAVED_ATTRIBUTE, "true");
  saved.setAttribute("aria-live", "polite");
  saved.textContent = SAVED_LABEL;
  saved.style.display = "inline-flex";
  saved.style.alignItems = "center";
  saved.style.padding = "2px 8px";
  saved.style.margin = "0 2px";
  saved.style.fontSize = "12px";
  saved.style.lineHeight = "18px";
  saved.style.color = "#00ba7c";
  saved.style.fontWeight = "600";
  saved.style.whiteSpace = "nowrap";
  return saved;
}

/* -------------------------------------------------------------------------- */
/* Bookmark surface (the icon inside X's action bar)                          */
/* -------------------------------------------------------------------------- */

/**
 * X tints its action icons on hover with CSS classes our button cannot borrow,
 * so the hover is one line of JS: the accent blue X's own bookmark hover uses.
 * The saved state is already accent, so it does not hover.
 */
function hoverToAccent(button: HTMLButtonElement, isSaved: () => boolean): void {
  button.addEventListener("mouseenter", () => {
    if (!isSaved()) button.style.color = ACCENT_BLUE;
  });
  button.addEventListener("mouseleave", () => {
    if (!isSaved()) button.style.color = "";
  });
}

/**
 * The bookmark-variant trigger: an icon-only bookmark button meant to live
 * *inside* X's action bar — the web twin of the phone's action-bar button. The
 * colour is inherited, so the glyph picks up whatever grey X's bar paints (and
 * the theme's value when that changes); the size is X's own action-icon size.
 *
 * Unsaved, the tap opens the folder picker; saved, the filled accent glyph's
 * tap opens the saved sheet (where it lives, move, remove). No popover panel is
 * built on this surface — the modal is mounted into `document.body` instead, so
 * no positioning has to survive X's layout.
 */
function bookmarkTrigger(doc: Document, options: OrganizerRenderOptions, root: HTMLElement): HTMLButtonElement {
  const button = doc.createElement("button") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("type", "button");
  button.setAttribute(TRIGGER_ATTRIBUTE, "true");
  button.className = "twb-trigger twb-bookmark-button";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "36px";
  button.style.height = "36px";
  button.style.padding = "0";
  button.style.margin = "0";
  button.style.border = "none";
  button.style.borderRadius = "50%";
  button.style.background = "transparent";
  button.style.color = options.saved ? ACCENT_BLUE : "inherit";
  button.style.cursor = "pointer";
  button.style.flex = "0 0 auto";
  button.appendChild(bookmarkGlyph(doc, Boolean(options.saved)));

  if (options.saved) {
    const slug = options.callbacks.savedSlugOf?.(options.tweetId) ?? null;
    const name = nameForSlug(options.categories, slug);
    button.setAttribute("aria-label", name ? `Saved in ${name}` : "Saved in Twitter Bookmarker");
  } else {
    button.setAttribute("aria-label", BOOKMARK_ARIA_LABEL);
    hoverToAccent(button, () => Boolean(lastOptions.get(root)?.saved));
  }

  button.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;

    // The tweet container is read at click time: at render time the root may
    // not be in the DOM yet, and extraction is rooted at the article (PRD §28).
    const context: OrganizerContext = {
      article: articleFor(root),
      tweetId: options.tweetId,
      source: button,
    };

    if (lastOptions.get(root)?.saved) {
      const slug = options.callbacks.savedSlugOf?.(options.tweetId) ?? null;
      openSavedModal({
        tweetId: options.tweetId,
        source: button,
        document: doc,
        categories: options.categories,
        savedSlug: slug,
        onMove: (category) => options.callbacks.onMove?.(category, context),
        onRemove: () => options.callbacks.onRemove?.(context),
      });
      return;
    }

    openSaveModal({
      tweetId: options.tweetId,
      source: button,
      document: doc,
      categories: options.categories,
      onPick: (category) => options.callbacks.onSelect(category, context),
    });
  });

  return button;
}

/* -------------------------------------------------------------------------- */
/* Popover state machine                                                      */
/* -------------------------------------------------------------------------- */

/** Close the (single) open popover, if any. Safe to call at any time. */
export function closeOpenPopover(): void {
  if (!openPopover) return;
  const current = openPopover;
  openPopover = null;
  current.panel.hidden = true;
  current.panel.style.display = "none";
  current.trigger.setAttribute("aria-expanded", "false");
  current.root.removeAttribute(POPOVER_OPEN_ATTRIBUTE);
  current.doc.removeEventListener("click", current.onDocumentClick, true);
  current.doc.removeEventListener("keydown", current.onDocumentKeydown);
}

/** True when `root` currently owns the open popover. */
export function isPopoverOpen(root: HTMLElement): boolean {
  return openPopover?.root === root;
}

/** Close the popover if its tweet left the DOM (PRD §32). */
export function closeStalePopover(): void {
  if (!openPopover) return;
  if (!openPopover.root.isConnected || !openPopover.panel.isConnected) closeOpenPopover();
}

function openPopoverFor(root: HTMLElement, trigger: HTMLElement, panel: HTMLElement): void {
  closeOpenPopover();
  const doc = root.ownerDocument;
  if (!doc) return;

  const onDocumentClick = (event: Event): void => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || trigger.contains(target))) return;
    closeOpenPopover();
  };
  const onDocumentKeydown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.stopPropagation();
    closeOpenPopover();
  };

  panel.hidden = false;
  panel.style.display = "flex";
  trigger.setAttribute("aria-expanded", "true");
  root.setAttribute(POPOVER_OPEN_ATTRIBUTE, "true");
  doc.addEventListener("click", onDocumentClick, true);
  doc.addEventListener("keydown", onDocumentKeydown);
  openPopover = { root, trigger, panel, doc, onDocumentClick, onDocumentKeydown };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render `options` into `root`, replacing any previous contents. Exactly one
 * `✓ Saved` label, one popover, one inline row, or one bookmark icon is produced.
 *
 * The bookmark surface renders the icon trigger and nothing else — no panel is
 * built, because its tap opens the modal. An open modal for this tweet is
 * closed first, matching how a re-render dismisses the popover it owned.
 */
export function renderOrganizer(root: HTMLElement, options: OrganizerRenderOptions): void {
  if (openPopover?.root === root) closeOpenPopover();
  if (options.variant === "bookmark") closeSaveModalFor(options.tweetId);

  const doc = root.ownerDocument;
  if (!doc) return;

  lastOptions.set(root, options);
  root.replaceChildren();
  root.className = "twb-root";

  if (options.saved) {
    root.setAttribute(STATE_ATTRIBUTE, "saved");
    if (options.variant === "bookmark") {
      root.appendChild(bookmarkTrigger(doc, options, root));
      return;
    }
    root.appendChild(savedElement(doc));
    return;
  }

  const categories = orderedCategories(options.categories);
  if (categories.length === 0) {
    // Nothing to organise; ui-injector normally avoids creating a root at all.
    root.setAttribute(STATE_ATTRIBUTE, "empty");
    return;
  }

  root.setAttribute(STATE_ATTRIBUTE, "ready");

  // The bookmark surface is icon + modal, always — the popover/inline choice is
  // the bookmarks timeline's setting and does not reach this surface.
  if (options.variant === "bookmark") {
    root.appendChild(bookmarkTrigger(doc, options, root));
    return;
  }

  if (options.displayMode === "inline") {
    for (const category of categories) root.appendChild(categoryButton(doc, category, options, root));
    return;
  }

  const trigger = makeButton(doc);
  trigger.setAttribute(TRIGGER_ATTRIBUTE, "true");
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.className = "twb-trigger";
  trigger.style.fontWeight = "600";

  // The label lives in its own span so the saving transition can swap the text
  // without rebuilding the trigger.
  const label = doc.createElement("span");
  label.className = "twb-trigger-label";
  label.textContent = triggerLabel(options.variant);
  trigger.appendChild(label);

  const panel = doc.createElement("div");
  panel.setAttribute(PANEL_ATTRIBUTE, "true");
  panel.className = "twb-panel";
  panel.setAttribute("role", "menu");
  panel.hidden = true;
  panel.style.position = "absolute";
  panel.style.bottom = "100%";
  panel.style.left = "0";
  panel.style.zIndex = "2147483000";
  panel.style.display = "none";
  panel.style.flexDirection = "column";
  panel.style.gap = "2px";
  panel.style.padding = "4px";
  panel.style.minWidth = "140px";
  panel.style.background = "#ffffff";
  panel.style.color = "#0f1419";
  panel.style.border = "1px solid rgba(0, 0, 0, 0.2)";
  panel.style.borderRadius = "8px";
  panel.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.25)";

  for (const category of categories) panel.appendChild(categoryButton(doc, category, options, root));

  trigger.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (trigger.disabled) return;
    if (isPopoverOpen(root)) closeOpenPopover();
    else openPopoverFor(root, trigger, panel);
  });

  root.append(trigger, panel);
}

/** Re-render `root` as saved/unsaved using its last options. */
export function updateOrganizerSaved(root: HTMLElement, saved: boolean): void {
  const options = lastOptions.get(root);
  if (!options) return;
  renderOrganizer(root, { ...options, saved });
}

/** Toggle the in-flight save state without rebuilding the controls (PRD §35). */
export function updateOrganizerSaving(root: HTMLElement, saving: boolean): void {
  if (root.getAttribute(STATE_ATTRIBUTE) === "saved") return;
  root.setAttribute(STATE_ATTRIBUTE, saving ? "saving" : "ready");

  const trigger = queryFirst<HTMLElement>(root, "organizerTrigger");
  if (trigger) {
    (trigger as HTMLButtonElement).disabled = saving;
    const options = lastOptions.get(root);
    if (options?.variant === "bookmark") {
      // Icon-only: say in-flight with opacity, not with text.
      trigger.style.opacity = saving ? "0.5" : "";
    } else {
      const label = trigger.querySelector<HTMLElement>(".twb-trigger-label");
      const idle = triggerLabel(options?.variant);
      if (label) label.textContent = saving ? SAVING_LABEL : idle;
      else trigger.textContent = saving ? SAVING_LABEL : idle;
    }
  }

  for (const button of queryAll<HTMLElement>(root, "categoryButton")) {
    (button as HTMLButtonElement).disabled = saving;
  }
}

/** Forget all popover/options state (used when the route is left). */
export function resetOrganizerState(): void {
  closeOpenPopover();
  closeSaveModal();
  lastOptions = new WeakMap<HTMLElement, OrganizerRenderOptions>();
}
