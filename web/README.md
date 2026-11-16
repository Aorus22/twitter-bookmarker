# Web gallery

The local gallery that reads the archive: Vite + React 19 + TypeScript, with the
chrome built on [Astryx](https://github.com/meta/astryx) and the remaining
primitives (dialogs, menus, popovers) on Radix via shadcn.

```bash
pnpm install
pnpm dev        # http://localhost:5173, proxies /api to 127.0.0.1:43121
pnpm test       # vitest + jsdom
pnpm typecheck
pnpm lint
pnpm build      # tsc -b && vite build
```

## Design system

The gallery is deliberately monochrome. Saved media is the only saturated thing
on the page, so the shell, control chrome and placeholder art are neutral.

- **Type:** Figtree (self-hosted via `@fontsource-variable/figtree`), one family
  for display and body. Headings are tight (`-0.02em` to `-0.045em`); body copy
  is 12–14px; metadata uses `font-variant-numeric: tabular-nums` via `.tnum`.
- **Colour:** warm paper `#f5f4f1` and charcoal `#0d0d0c` bodies, white/`#171716`
  surfaces, near-black/near-white accent. The functional destructive red is the
  only hue in the chrome.
- **Shape and depth:** 8/10/12/14px radii, a 1px hairline border, and almost no
  shadow. Only popovers, sheets and the lightbox float.
- **Tokens:** `src/index.css` holds the light/dark custom properties, the
  Tailwind mapping, placeholder gradients (all stone-toned) and the CSS layer
  order. `src/app/astryx-theme.ts` maps the same scale onto Astryx.

### Astryx notes

`src/app/astryx.tsx` is the theme surface used around the Astryx controls
(theme toggle, skeletons, the two state actions). It is intentionally **not**
wrapped around the whole app: Astryx's runtime theme emits `h1`–`h6` rules, and
wrapping the page would override the gallery's own type scale. The `#root`
element also carries `data-astryx-theme="app"` as a scope boundary for the same
reason.

### Responsive

- Collections: 2 columns on phones, 3 at `sm`, 4 at `xl`.
- The post masonry is measured: 1 column below 616px, 2 at 616, 3 at 940, 4 at
  1264, 5 at 1588. A single column is allowed to fill the phone width (capped at
  420px on tablets); multi-column layouts keep the exact-fit 292px card.
- The filter is a popover at `md` and up, and a bottom sheet below it.
- The lightbox stacks media over metadata below `md`.

## Tests

Every test mocks `fetch`; there is no network and no live backend. The suites
cover the data hooks, the API client, the lightbox keyboard model, curation
dialogs, and the visual contracts that are easy to regress (clamp, paging,
responsive column counts, Astryx heading scope).

## Adding shadcn components

```bash
npx shadcn@latest add button
```

Components land in `src/components/ui`. Keep the neutral token contract in
`src/index.css`; do not introduce a second palette.
