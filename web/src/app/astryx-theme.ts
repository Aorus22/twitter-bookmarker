// Astryx theme for the gallery shell. One neutral scale, one near-black accent,
// Figtree everywhere: the archive is monochrome so the saved media is the only
// thing with colour.
import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

const sans =
  '"Figtree Variable", "Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const galleryTheme = defineTheme({
  name: "twitter-bookmarker",
  extends: neutralTheme,
  tokens: {
    "--font-family-body": sans,
    "--font-family-heading": sans,
    "--font-family-code": sans,
    "--radius-container": "14px",
    "--radius-element": "10px",
    "--radius-inner": "8px",
    "--color-background-body": ["oklch(0.975 0.002 90)", "oklch(0.145 0 0)"],
    "--color-background-surface": ["oklch(1 0 0)", "oklch(0.178 0 0)"],
    "--color-background-card": ["oklch(1 0 0)", "oklch(0.196 0 0)"],
    "--color-background-popover": ["oklch(1 0 0)", "oklch(0.205 0 0)"],
    "--color-background-muted": ["oklch(0.945 0.003 90)", "oklch(0.235 0 0)"],
    "--color-skeleton": ["oklch(0.915 0.004 90)", "oklch(0.27 0 0)"],
    "--color-border": ["oklch(0.912 0.004 90)", "oklch(1 0 0 / 10%)"],
    "--color-border-emphasized": ["oklch(0.86 0.005 90)", "oklch(1 0 0 / 18%)"],
    "--color-text-primary": ["oklch(0.17 0 0)", "oklch(0.97 0 0)"],
    "--color-text-secondary": ["oklch(0.52 0.005 80)", "oklch(0.72 0 0)"],
    "--color-accent": ["oklch(0.2 0 0)", "oklch(0.94 0 0)"],
    "--color-accent-muted": ["oklch(0 0 0 / 7%)", "oklch(1 0 0 / 12%)"],
    "--color-on-accent": ["oklch(0.99 0 0)", "oklch(0.2 0 0)"],
    "--color-text-accent": ["oklch(0.2 0 0)", "oklch(0.94 0 0)"],
    "--color-icon-accent": ["oklch(0.2 0 0)", "oklch(0.94 0 0)"],
  },
});
