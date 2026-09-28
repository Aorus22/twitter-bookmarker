# Phase 2 Web Gallery — Design Specification

**Design authority:** Figma file `Twitter Bookmarker — Phase 2 Gallery Mockups`
**File key:** `RAxDbIIUbz2mtNJtXXuDGQ`
**Page:** `Gallery Mockups v2 — Editorial` (page node `6:2`)

> The file also contains a first-pass page named `Gallery Mockups` (`0:1`, neutral/shadcn
> palette). It was **superseded** — the user explicitly selected the v2 Editorial direction.
> Do not build to page 1. Its only lasting artifact is the `Theme` variable collection
> (neutral light/dark), which is *not* used by this design.

**Status:** Approved direction · extracted 2026-09-27 via the Figma Desktop Bridge.
**Consumers:** every frontend phase (3–10). Backend phases only need §2 for the `cover_media` count rules.

---

## 1. Frame map

| # | Frame | Node | Size |
|---|-------|------|------|
| 01 | Gallery / Editorial Desktop | `6:16` | 1440×1120 |
| 02 | Collection / Editorial Desktop | `6:121` | 1440×1440 |
| 03 | Filter Open / Editorial | `6:236` | 1440×1440 |
| 04 | Lightbox / Editorial | `6:373` | 1440×1440 |
| 05 | Collection / Night Mode | `6:505` | 1440×1440 |
| 06 | Mobile / Editorial | `6:552` | 390×844 |
| 07 | Product States / Editorial | `6:594` | 1440×900 |

Figma variable collections: `Gallery V2 Brand` (12 colors, single mode) and `Theme`
(8 colors, Light/Dark — from the superseded page; see §3.3 for the derived dark set).

---

## 2. Design tokens

### 2.1 Palette — light (from `Gallery V2 Brand`)

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#f6efe7` | Page background (warm cream) |
| `--surface` | `#fffdfc` | Cards, nav bar, popover, lightbox panel |
| `--surface-warm` | `#fff6f0` | Search fields, info panel, secondary buttons, pills |
| `--ink` | `#171419` | Primary text |
| `--muted` | `#746b72` | Secondary text, usernames, meta, placeholders |
| `--border` | `#e8dcd3` | Hairline borders (1px) |
| `--accent` | `#bf3f2e` | Coral — active nav, eyebrows, active pill text, CTA (**darkened in Phase 10 for WCAG AA; the mockup value `#f26a5b` measured 2.96:1 on `--surface`**) |
| `--accent-pink` | `#ff8fa3` | Collage/placeholder accent |
| `--accent-violet` | `#7c5cfc` | Collage/placeholder accent |
| `--accent-blue` | `#5b8cff` | Collage/placeholder accent |
| `--accent-gold` | `#f2b65a` | Collage/placeholder accent |
| `--accent-green` | `#63a988` | Collage/placeholder accent |

### 2.2 Palette — dark (derived from frame `6:505`)

The night frame uses a vertical gradient `#161319 → #201822` as its page background and
`#28212d` surfaces with `#3b3140` borders. The mockup leaves `muted` at the light-mode
`#746b72`, which is ≈3:1 on `#28212d` and fails PRD §67 ("adequate contrast"). The dark
muted and accent values below are therefore **lightened** so every text pairing clears
WCAG AA for its size.

| Token | Value | Note |
|-------|-------|------|
| `--bg` | `#161319` (gradient to `#201822`) | from mockup |
| `--surface` | `#28212d` | from mockup |
| `--surface-warm` | `#332a37` | derived elevation step |
| `--ink` | `#fffdfc` | from mockup |
| `--muted` | `#b3a8ae` | **lightened** from `#746b72` for contrast |
| `--border` | `#3b3140` | from mockup |
| `--accent` | `#ff8b7d` | **lightened** coral for dark surfaces |
| `--accent-pink` | `#ff9fb2` | |
| `--accent-violet` | `#a48bff` | |
| `--accent-blue` | `#7ea6ff` | |
| `--accent-gold` | `#f5c877` | |
| `--accent-green` | `#7fc0a0` | |

Theme mechanic: `system` is the **default**. The document root carries `class="dark"` (or
`data-theme="dark"`) when resolved dark; tokens are declared as CSS custom properties so
Tailwind utilities pick them up.

### 2.3 Typography

| Family | Weights | Role |
|--------|---------|------|
| **Playfair Display** | Bold 700, Regular 400 | Display/editorial voice: hero, page titles, section + card titles, quote panel, popover title, state titles |
| **Inter** | Regular 400, Medium 500, SemiBold 600, Bold 700 | All UI: nav, buttons, labels, body, metadata |

Both are Google Fonts; self-host or load via `@fontsource` — no runtime CDN dependency is required.

Scale (desktop; mobile noted where it differs):

| Role | Family / weight | Size | Line height |
|------|-----------------|------|-------------|
| Hero headline | Playfair Bold | 46 | 1.05 |
| Collection title | Playfair Bold | 38 (mobile 28) | 1.1 |
| Section title ("My Collections") | Playfair Bold | 28 | 1.2 |
| Popover title ("Filter your archive") | Playfair Bold | 24 | 1.15 |
| Card title | Playfair Bold | 22 | 1.2 |
| State title | Playfair Bold | 20 | 1.3 |
| Quote panel text | Playfair Regular | 22 | 1.35 |
| Hero art caption | Playfair Regular | 20 | 1.3 |
| Nav brand | Inter SemiBold | 15 | 1.4 |
| Hero body | Inter Regular | 14 | 1.45 |
| Lightbox post text | Inter Regular | 13 | 1.4 |
| Nav link | Inter Medium 12 / active SemiBold 12 | 12 | 1.4 |
| Button / control | Inter Medium 12 / primary SemiBold 12 | 12 | 1.4 |
| Card body text | Inter Regular | 11 | 1.45 |
| Card author | Inter SemiBold | 11 | 1.4 |
| Labels / pill text | Inter SemiBold 11 / inactive Medium 11 | 11 | 1.4 |
| Eyebrow | Inter SemiBold 10, uppercase, +0.12em tracking | 10 | 1.4 |
| Card meta (dates) | Inter Regular | 9–10 | 1.4 |
| Card username | Inter Regular | 9 | 1.4 |

### 2.4 Radii

`--r-sm: 12px` (controls, fields) · `--r-md: 14px` (media tiles, CTA) ·
`--r-lg: 18px` (nav, post cards) · `--r-xl: 20px` (collection cards, popover, lightbox media/info) ·
`--r-2xl: 24–26px` (lightbox panel, hero, collection icon) · `--r-pill: 999px`

### 2.5 Shadows

| Token | Value (mockup blur radius) |
|-------|----------------------------|
| `--shadow-nav` | `0 4px 20px rgba(23,20,25,.06)` (blur 20) |
| `--shadow-card` | `0 8px 28px rgba(23,20,25,.07)` (blur 28) |
| `--shadow-post` | `0 8px 22px rgba(23,20,25,.06)` (blur 22) |
| `--shadow-popover` | `0 12px 30px rgba(23,20,25,.12)` (blur 30) |
| `--shadow-hero` | `0 16px 32px rgba(23,20,25,.10)` (blur 32) |

Shadows must be reduced/removed in dark mode; rely on surface + border contrast instead.

### 2.6 Signature gradients

`--grad-brand`: `linear-gradient(135deg,#ff9b58,#8b5cf6)` — brand mark (40×40, r12) and avatars
`--grad-hero`: `linear-gradient(135deg,#fff2e8,#f6e7ff)` — hero panel
`--grad-cta`: `linear-gradient(135deg,#26202b,#4a4054)` — primary CTA
`--grad-night`: `linear-gradient(180deg,#161319,#201822)` — dark page background

Placeholder gradient pairs (for 0-media covers, broken images, state art, quote panels):
`gold→blue`, `violet→pink`, `green→lime`, `plum→rose`, `teal→mint`, `sand→sage`.
Pick deterministically from a stable key (e.g. `hash(filename)` / `hash(tweet_id)`) so a
given collection or post always renders the same placeholder.

---

## 3. Layout specification

### 3.1 Global shell

**Desktop** page gutter `64px`; content max width `1312px` (1440 − 2×64).

**Top navigation** — `1312×58`, top offset `24`, `r18`, `surface` bg, `border` hairline,
`shadow-nav`, horizontal padding `12`:

- brand mark `40×40` `r12` `grad-brand` with a white glyph, then `Twitter Bookmarker` (Inter SemiBold 15)
- nav links at x≈255: `Home` (active → coral, SemiBold), `Collections`, `Explore` (Medium, muted) — **gap 24–28px**
- search field `370×38` `r12` `surface-warm` + border, placeholder `⌕ Search your saved tweets…` (Inter Regular 12, muted)
- avatar `34×34` `r17` gradient

> **Scope note:** the mockup's nav search and `Explore` link have no Phase 2 destination or
> endpoint. Render `Home` and `Collections` as real navigation (both resolve to `/`), keep the
> search field **only** where it is functional (the collection toolbar), and omit `Explore` —
> see §7 "Deliberate deviations". The nav search input is therefore omitted rather than shipped dead.

**Mobile** (390): nav `358×58` at `16,24`; brand + hamburger only (nav links collapse).

### 3.2 Homepage (`/`) — frame `6:16`

1. **Hero** `1312×320` at y=108, `grad-hero`, `r26`, `shadow-hero`, padding `36`
   - eyebrow `YOUR TWITTER ARCHIVE, REIMAGINED` (coral, uppercase)
   - headline `Save. Organize.⏎Relive inspiration.` (Playfair Bold 46, max-width 520)
   - body copy (Inter Regular 14, muted, max-width 510)
   - CTA `Explore gallery` `134×42` `r14` `grad-cta`, white SemiBold 12
   - hero art `560×272` at x=718, `r22`, gradient collage of 3–4 tiles `r14` plus a white
     Playfair Regular 20 caption. **Placeholder art** — assemble it from the newest
     `cover_media` when media exists, otherwise fall back to gradient tiles. The caption
     carries the **archive totals** — `3 collections · 12 posts · 16 media` — because this
     is the only aggregate in the UI: every other count is per collection, so without it
     "how much have I saved in total" has no answer anywhere. Adding the post total makes
     the line long enough to wrap at narrow widths, so the caption is
     `max-w-[calc(100%-2rem)]`; without the cap the pill ran up against the art's border
     and read as an overflow rather than as a caption.
2. **Section header** at y=466: `My Collections` (Playfair Bold 28) + `N collections`
   (Inter Medium 11, muted, baseline-aligned); right-aligned `Recently updated ▾` control
   `160×38` `r12` (visual only — ordering is fixed `last_saved_at DESC` per PRD §38, so
   render it as a static label, not a menu).
3. **Collection grid** at y=520: cards `244×330`, gap `18px` (326−64−244=18), wrapping
   responsively.
4. **Footer line**: `Local-only · Powered by your CSV archive · No cloud, no algorithmic feed`
   (Inter Regular 11, muted), `.../·/...` separators.

**Collection card** `244×330` — `surface`, `r20`, `border`, `shadow-card`, no padding on the collage:

| Element | Spec |
|---------|------|
| Collage | full-bleed top region `245×181`; 2×2 tiles `120×88` `r14` with `5px` gap; outer top corners follow `r20` |
| Name | Playfair Bold 22 at `(18,198)` |
| Secondary line | Inter Regular 11 muted at `(18,231)` |
| Meta | `248 posts ◫ 312 media` Inter Medium 11 muted at `(18,288)` |
| Overflow | `•••` at `(206,288)` — **omit** unless a real action exists (PRD has no card actions) |
| Bookmark chip | **added** — `N` with a bookmark glyph, pill over the collage at top-right: white Inter SemiBold 11 on `black/45`, `r999`, `backdrop-blur-sm`. Carries the collection's `post_count` and is `aria-hidden`, because the card link's accessible name already includes it via the meta row. The meta row spells the count out in words as well; the chip exists because that row is 11px muted text at the bottom of the card, while "how many are in this folder" is what people scan a collection for. A `surface` pill was tried first and rejected: a near-opaque cream chip on saturated collage tiles read as a sticker pasted onto the art, so it reuses the hero caption's `black/45` overlay treatment instead. |

Cover collage must follow PRD §17: **4+** → four newest `saved_at DESC`; **3** → balanced
2-top + 1-wide-bottom (or 1-wide-top + 2-bottom); **1** → single full tile; **0** → gradient
placeholder with a neutral glyph. Never use an avatar as a cover.

**PRD-required content the mockup omits:** the card must also show **last bookmarked date**
(PRD §16). Render it in the meta row, e.g. `248 posts · 312 media · Last saved Sep 27`, styled
as the mockup's Inter Medium 11 muted. The mockup's one-line collection *description* is
dropped — CSV has no description field (§7).

**Spec validated against Figma** (2026-09-27, structural extraction of frame `6:16`
"01 · Gallery / Editorial Desktop", 1440×1120). Every figure above was confirmed node-for-node:

| Measurement | Figma | This spec |
|---|---|---|
| Card box / radius | `244×330`, `r20` | same |
| Collage tiles | `120×88`, `r14`, at x=0/125, y=0/93 | same → **5px** gaps, region `245×181` |
| Name | `(18,198)`, Playfair Display Bold 22 | same |
| Secondary line | `(18,231)`, Inter Regular 11 — a *description* | **dropped** (§7: no CSV field) |
| Meta | `(18,288)`, Inter Medium 11 | same, plus the PRD §16 last-saved date |
| `•••` overflow | `(206,288)`, Inter Bold 11 | **omitted** (§7: no card action exists) |
| Card pitch | x = 64, 326, 588, 850, 1112 | **18px** gap between 244-wide cards |
| Content column | hero and grid both `1312` at x=64 | same |
| Section header | `My Collections` y=466 @28; `N collections` y=480 @11 | same |
| Footer line | y=938, Inter Regular 11 | same |

Two consequences worth flagging for implementation: the grid fits **5 columns** at 1440px
(5×244 + 4×18 = 1292 ≤ 1312), and the mockup's per-card description text exists in Figma but
has no backing CSV column — so it must not be rendered.

### 3.3 Collection page (`/collections/:filename`) — frame `6:121`

1. **Back link** `← Collections` (Inter Medium 11, muted) at y=112.
2. **Header block** at y=144:
   - collection icon `96×96` `r24` gradient (deterministic from filename), white glyph
   - title Playfair Bold 38 at x=184
   - secondary line Inter Regular 12 muted at y=198 (description — **omit**, see §7)
   - meta `186 posts ◫ 220 media` Inter Medium 11 muted at y=236 (mobile: 11)
3. **Toolbar** at y=292, all controls `40` tall:
   - search field `440×40` `r12` `surface`+border, placeholder `⌕ Search this collection…`
   - `Filter` button `86×40` `r12` `surface`+border with a filter glyph
   - `Sort: Newest ▾` control `150×40` `r12`
4. **Masonry** starting y=448: 4 columns of cards `292` wide, horizontal gap `32px`
   (388−64−292), vertical gap `22px` (verified: card tops 448→970 for a 500-tall card, and
   448→1035 for a 565-tall card), true masonry (cards start at differing offsets and have
   natural heights — the mockup shows tops at 448/900/950/970/1035).

**Spec validated against Figma** (2026-09-27, structural extraction of frames `6:121`
"02 · Collection / Editorial Desktop" 1440×1440, `6:236` "03 · Filter Open / Editorial", and
`6:594` "07 · Product States / Editorial" 1440×900):

| Measurement | Figma | This spec |
|---|---|---|
| Header: back link / icon / title / meta | `(64,112)` @11 · `96×96 r24` at `(64,144)` · Playfair Bold 38 at `(184,148)` · @11 at `(184,236)` | same |
| Toolbar controls | search `440×40 r12` at `(64,292)`, Filter `86×40 r12` at `(516,292)`, Sort `150×40 r12` at `(612,292)` | same |
| Media-type pills | `All/Images/Videos/Links/Text` at y=350, `r999` | **omitted** (§7) |
| Topic pills | `Terminal ×/Tools ×/Self-hosting ×/Linux Tips ×` at y=394 | **omitted** (§7) |
| Post cards | `292` wide, `r18`, columns at x = 64/388/712/1036 | 4 columns, **32px** gap |
| Masonry vertical rhythm | tops 448/900/950/970/1035; gap 22 | **22px** |
| Post-card padding + media inset | media `272` wide at `(10,10)`, `r14` | padding **10**, media `r14` |
| Media region heights | 130 / 185 / 260 | adaptive, not fixed |
| Quote panel (text-only) | `272×210` `r14` at `(10,10)` | kept |
| Filter popover | `390×470`, `r20` at `(500,340)` | same |
| State cards | `292×320`, `r20`, 4 across at gap 32 | same |

Two structural notes: the mockup's 4-column pitch leaves the 5-column desktop grid to the
homepage, and the collection page's toolbar row is `440 + 86 + 150` wide with ~10–12px gaps,
not a single flex row with equal spacing.

**Implementation note — the collection column is centred** (revised after v2.0 shipped). Figma
puts the cards on the same `x=64` rail as the hero and the toolbar. That reads well at 1440,
where `4×292 + 3×32 = 1264` misses the `1312` content column by only 48px — but the slack grows
to 212–292px between two column thresholds (at a 1360px window the rail is 1232 and the grid is
still 3 columns = 940), and a hole that size on the right stops reading as a page margin and
starts reading as breakage. The page therefore caps the **whole content column** — hero, toolbar
and masonry together — at `masonryContainerWidth(count)` and centres it, so the cards fill it
edge to edge and the gutters stay equal at every width. The card is still exactly `292`; only
the column the page arranges them in is centred. Centring the masonry *alone* was rejected: it
would leave the cards inset from the toolbar above them, trading one misalignment for another.
The collections index (§3.2) keeps the plain `1312` rail, where its 5×244 pitch already fills
the column.

**Post card** — width `292`, radius `r18`, `surface`, `border`, `shadow-post`, padding `10`:

| Element | Spec |
|---------|------|
| Media region | top, `272` wide, `r14`; height follows aspect (mockup uses 130 / 185 / 260) |
| Quote panel (text-only) | `272×~210` `r14` gradient; text Playfair Regular 22, padding `18/24` |
| Avatar | `28×28` `r14` gradient at `(14, …)` |
| Author | Inter SemiBold 11 `ink` at x=50 |
| Username | `@name` Inter Regular 9 `muted` |
| Body text | Inter Regular 11 `ink`, width 264, gap 12 below the header row |
| Meta | `Mar 12, 2026 · Saved Apr 3` Inter Regular 9 `muted`, pinned above the link |
| Link | `Open on X ↗` Inter SemiBold 10 `ink` |

Meta row rendering: PRD wants both dates visible; the mockup uses `Posted <date> · Saved <date>`.
Keep the `·` separator and both dates, and make the whole card's `Open on X` an `<a>` with
`target="_blank" rel="noopener noreferrer"`.

**Multi-media layouts** (media region, all tiles `r14`, gap `~6px`):

- 1 → single tile, natural aspect
- 2 → 50/50 split side by side
- 3 → wide tile on top + 2 tiles below (adaptive 2/1)
- 4+ → compact grid (2×2 for 4; 2 columns × N rows beyond, capped by the CSV's actual count)

### 3.4 Filter popover — frame `6:236` (`Filter Popover`)

`390×470`, `r20`, `surface`, `border`, `shadow-popover`, padding `22`; anchored below the
Filter button on desktop; rendered as a **Sheet/Drawer** below the `md` breakpoint (PRD §30/§66).

| Element | Spec |
|---------|------|
| Title | `Filter your archive` Playfair Bold 24 |
| Subtitle | `Mix posted and bookmarked dates together.` Inter Regular 11 muted |
| Section label | `Tweet date` / `Bookmarked date` / `Quick ranges` Inter SemiBold 11 `ink` |
| Date field | `346×42` `r12` `surface-warm`+border, text Inter Regular 11, format `Jan 1, 2026 → Sep 27, 2026` |
| Quick pills | `32` tall, `r-pill`; inactive `surface-warm`+border + Medium 11 muted; **active** gradient fill + SemiBold 11 coral |
| `Reset` | `78×40` `r12` `surface-warm`+border, Inter Medium 11 |
| `Apply` | `92×40` `r12` gradient, white Inter SemiBold 11, right-aligned |

Presets: `Today`, `7 days` (Last 7 Days), `30 days` (Last 30 Days), `This year`. They target
the **Bookmarked date** range (PRD §31) and remain manually overridable.

### 3.5 Lightbox — frame `6:373`

- **Scrim** full viewport `#120d14` at `82%` opacity.
- **Panel** `1220×820` centered, `r24`, `surface`, `shadow-popover`
- **Media area** `800×760` at inset `30`, `r20`, near-black backdrop; active image contained;
  prev/next controls at the left/right edges; a `n / total` counter
- **Info panel** `330×760` at x=860, `r20`, `surface-warm`, padding `22`
  - `×` close at top-right `(286,16)` Inter Medium 22
  - author Inter SemiBold 13, `@username` Inter Regular 10 muted
  - post text Inter Regular 13 `ink`, clamped with `Show more`
  - meta block Inter Regular 10 muted, three lines: `Posted <date>` / `Saved <date>` / `Collection <name>`
  - `Open on X ↗` button `286×42` `r12` `surface`+border pinned near the bottom (`y=690`)
- **Mobile**: media on top (contained, ~55vh) with the info panel stacked below.
- Keyboard: `Escape` closes, `←`/`→` navigate; focus is trapped and restored. Navigation
  crosses tweet boundaries once the last media of a post is passed (PRD §27).

### 3.6 Product states — frame `6:594`

State card `292×320`, `r20`, `surface`, `border`, padding `20`:
gradient "state art" `252×110` `r16` with a glyph, then a Playfair Bold 20 title and an
Inter Regular 11 muted message (2 lines).

| State | Title | Message |
|-------|-------|---------|
| Empty gallery | `No collections yet` | `Saved tweets will appear here after you organize them with the extension.` |
| Empty collection | `This collection is empty` | `This folder is quiet. The next bookmark will bring it to life.` |
| No filter results | `No posts match your filters` | + `Clear filters` action |
| Loading | `Loading` | `Gathering your saved things…` (use **skeleton cards** for the collection grid per PRD §35) |
| Error | `Could not load this collection` | `Retry` action |

**Copy authority:** where PRD §59–§61 prescribes exact strings (`No collections yet`,
`This collection is empty`, `No posts match your filters`, `Could not connect to Twitter
Bookmarker backend`, `Could not load this collection`, `Retry`, `Clear filters`), the PRD
string wins. The Figma secondary lines are adopted as supporting copy. The mockup's
`Empty gallery` / `Empty collection` / `Error` headline words are replaced by the PRD strings.

---

## 4. Component inventory → PRD §73

| Component | Phase | Notes |
|-----------|-------|-------|
| `AppShell` / `TopNav` | 3 | brand mark, links, theme toggle, avatar |
| `ThemeProvider` + toggle | 3 | light/dark/system, `system` default |
| `api` client + types | 3 | relative `/api/gallery/...` only |
| `GalleryPage` | 4 | hero + section header + collection grid |
| `CollectionCard` | 4 | cover collage, name, counts, last saved |
| `CollectionCover` | 4 | 4+/3/1/0 adaptive collage, broken-image fallback |
| `MasonrySkeleton` | 4/7 | masonry-shaped skeletons |
| `GalleryEmptyState` | 4/5 | table above |
| `GalleryErrorState` | 4/5 | message + `Retry` |
| `CollectionPage` | 5 | header + toolbar + masonry |
| `GalleryMasonry` | 5 | CSS columns or measured absolute layout; non-uniform heights |
| `PostCard` | 5 | card chrome, author row, body, meta, link |
| `PostMediaGrid` | 5 | 1/2/3/4+ adaptive layouts, lazy images, error fallback |
| `TextPostCard` | 5 | quote-panel treatment |
| `GalleryToolbar` | 6 | search + filter + sort |
| `SearchInput` | 6 | 300 ms debounce |
| `FilterPopover` / `FilterSheet` | 6 | popover ≥ md, Sheet < md |
| `DateRangeFilter` | 6 | local dates → RFC3339 UTC boundaries |
| `SortSelect` | 6 | four modes |
| `InfiniteLoader` | 7 | IntersectionObserver sentinel + bottom spinner |
| `MediaLightbox` | 8 | Dialog, focus trap, prev/next, keyboard |
| `LightboxInfoPanel` | 8 | author, text, dates, collection, Open on X |

---

## 5. Backend implications of the design

- `cover_media` must be the **four newest media by `saved_at` DESC** (PRD §17/§39) so the
  homepage collage has its tiles without extra requests.
- `media_count` is the count of all media items, and collections with `media_count == 0`
  must still be returned (PRD §9) so the placeholder cover renders.
- `last_saved_at` may be `null`; the frontend must render a neutral string (e.g. `No saves yet`)
  and must not sort such collections above real ones (PRD §38).
- The collection icon gradient and all placeholder gradients are **frontend-derived** from
  `filename` / `tweet_id` — the backend sends no colour data.
- Avatar gradients are a frontend fallback only: the CSV has no avatar URL, so the design's
  gradient avatar circle is the correct rendering, seeded from `username`.

---

## 6. Accessibility requirements carried from PRD §67

- Keyboard reachable controls with visible focus rings (use `--accent` ring on `--surface`).
- Semantic `<button>` / `<a>`; the post's `Open on X` is a real link.
- Every image gets `alt` text derived from author + tweet context; decorative collage tiles
  get `alt=""` and `aria-hidden`.
- Lightbox is a Dialog with a focus trap; `Escape` closes; arrows navigate.
- Contrast: dark-mode `muted` and `accent` are pre-lightened (§2.2). Verify with the
  `figma_lint_design` / axe checks during Phase 10.
- Text-only cards must expose the tweet URL in text form (the `Open on X` link), never only
  through a clickable image.

---

## 7. Deliberate deviations from the mockup (recorded decisions)

| Mockup element | Decision | Reason |
|----------------|----------|--------|
| Collection description line (homepage card + collection header) | **Omitted** | CSV has no description field; inventing one creates a second source of truth |
| Topic/tag chips (`Terminal ×`, `Tools ×`, `Linux Tips ×`) | **Omitted** | No tags in the CSV schema; PRD §40 defines no such filter |
| Media-type chips (`All`/`Images`/`Videos`/`Links`/`Text`) | **Omitted** | PRD defines no media-type filter and explicitly excludes video playback |
| Homepage hero search field | **Omitted** | PRD §28 scopes search to the collection detail page; nav search has no endpoint |
| `Explore` nav destination | **Omitted** | No such route or requirement; nav shows `Home` / `Collections` |
| `•••` card overflow menu | **Omitted** | PRD §5 forbids edit/delete/move/rename actions |
| `Recently updated ▾` as a menu | **Static label** | PRD §38 fixes homepage ordering to `last_saved_at DESC` |
| Dark-mode `muted` `#746b72` | **Lightened to `#b3a8ae`** | Fails PRD §67 contrast on `#28212d` |
| `Empty gallery` / `Empty collection` / `Error` headline words | **Replaced with PRD strings** | PRD §59–§61 prescribes exact user-facing copy |
| Mobile 2-column masonry at 390px | **1 column** | PRD §21/§66 require 1 column on small viewports |
| Text-only gradient "quote panel" | **Kept** | Chosen design; PRD §22 only says an artificial placeholder is "not needed", and the panel adds no fake media semantics |

---

*Extracted 2026-09-27 from Figma page `Gallery Mockups v2 — Editorial` via the Desktop Bridge.
Re-query node ids in §1 if the design changes; tokens in §2 are copies, not live bindings.*
