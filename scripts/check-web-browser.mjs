#!/usr/bin/env node
/**
 * Real-browser acceptance checks for the gallery SPA (PRD-2 §81, §82; HARD-03/04).
 *
 * Drives headless Firefox through WebDriver BiDi (see ./lib-bidi.mjs) so the
 * checks that jsdom cannot make — focus rings, real key events, live layout,
 * responsive column counts, actual network fetches — are verified for real.
 *
 * Usage:
 *   node scripts/check-web-browser.mjs --base http://127.0.0.1:43121 [--out DIR] [--collection linux.csv]
 *
 * Exits non-zero if any check fails. Screenshots are written to --out for
 * human review of visual fidelity.
 */

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { withBrowser, waitFor } from "./lib-bidi.mjs"

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = arg("base", "http://127.0.0.1:43121").replace(/\/$/, "")
const OUT = resolve(arg("out", "artifacts/browser"))
const COLLECTION = arg("collection", "linux.csv")

mkdirSync(OUT, { recursive: true })

const results = []
let shotIndex = 0

function record(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

async function check(name, fn) {
  try {
    const detail = await fn()
    record(name, true, detail ?? "")
  } catch (err) {
    record(name, false, err.message)
  }
}

const shot = async (browser, label) => {
  const file = `${OUT}/${String(++shotIndex).padStart(2, "0")}-${label}.png`
  await browser.screenshot(file)
  return file
}

// --- helpers -----------------------------------------------------------------

const countOf = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`
const textOf = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? "").trim()`
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`

async function waitForCards(browser, { atLeast = 1 } = {}) {
  await browser.waitForExpr(`${countOf('[data-testid="post-card"]')} >= ${atLeast}`, {
    label: `${atLeast} post cards`,
  })
}

// --- the run ----------------------------------------------------------------

await withBrowser(async (browser) => {
  // 1. Homepage
  await check("homepage renders hero, section header and collection cards", async () => {
    await browser.viewport(1440, 1100)
    await browser.goto(`${BASE}/`)
    await browser.waitForExpr(exists('[data-testid="gallery-hero"]'), { label: "hero" })
    const cards = await browser.eval(countOf('[data-testid="collection-card"]'))
    if (cards < 1) throw new Error(`expected >=1 collection card, got ${cards}`)
    const header = await browser.eval(`document.body.innerText.includes("My Collections")`)
    if (!header) throw new Error('"My Collections" section header missing')
    const footer = await browser.eval(`document.body.innerText.includes("No cloud, no algorithmic feed")`)
    if (!footer) throw new Error("footer line missing")
    await shot(browser, "homepage-light")
    return `${cards} collection cards`
  })

  await check("each collection card shows counts and a last-saved date", async () => {
    const text = await browser.eval(textOf('[data-testid="collection-card"]'))
    if (!/\d+\s+posts/i.test(text)) throw new Error(`post count missing in card meta: ${text}`)
    if (!/\d+\s+media/i.test(text)) throw new Error(`media count missing in card meta: ${text}`)
    if (!/last saved/i.test(text)) throw new Error(`last-saved date missing in card meta: ${text}`)
    return text.slice(0, 80)
  })

  // 2. Theme (WEB-06 / HARD-04)
  await check("theme resolves and toggles, and persists across reload", async () => {
    const before = await browser.eval(
      `document.querySelector('[data-theme-resolved]')?.getAttribute('data-theme-resolved')`
    )
    if (!["light", "dark"].includes(before)) throw new Error(`unexpected resolved theme: ${before}`)
    const htmlClass = await browser.eval(`document.documentElement.className`)
    if (!htmlClass.includes(before)) throw new Error(`<html> class "${htmlClass}" does not match resolved "${before}"`)

    await browser.click("[data-theme-preference]")
    const after = await browser.eval(`document.documentElement.className`)
    if (after.includes(before) && (before === "dark") === after.includes("dark")) {
      throw new Error(`toggling did not change the applied theme (still ${after})`)
    }
    await shot(browser, `theme-${after.includes("dark") ? "dark" : "light"}`)

    await browser.goto(`${BASE}/`)
    await browser.waitForExpr(exists("[data-theme-preference]"), { label: "theme toggle" })
    const persisted = await browser.eval(
      `document.querySelector('[data-theme-resolved]')?.getAttribute('data-theme-resolved')`
    )
    if (persisted !== (after.includes("dark") ? "dark" : "light")) {
      throw new Error(`theme did not persist: applied ${after}, after reload ${persisted}`)
    }
    // restore light for the remaining visual checks
    await browser.eval(`document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); true`)
    return `${before} → toggled → persisted`
  })

  // 3. Direct deep-link load (PROD-03 / §82 step 3)
  await check("deep link to a collection route survives a direct load (SPA fallback)", async () => {
    await browser.goto(`${BASE}/collections/${COLLECTION}`)
    await waitForCards(browser)
    const counts = await browser.eval(textOf('[data-testid="collection-counts"]'))
    const hasToolbar = await browser.eval(exists('[data-testid="collection-toolbar"]'))
    if (!hasToolbar) throw new Error("toolbar missing on collection route")
    await shot(browser, "collection-route")
    return counts
  })

  await check("masonry reports a desktop column count of 4 at 1440px", async () => {
    const cols = await browser.eval(
      `document.querySelector('[data-testid="gallery-masonry"]')?.getAttribute('data-columns')`
    )
    if (cols !== "4") throw new Error(`expected data-columns="4" at 1440px, got ${cols}`)
    return `data-columns=${cols}`
  })

  // 4. Search (DISC-01 / §82 step 7)
  await check("search narrows results server-side and writes q= to the URL", async () => {
    const before = await browser.eval(countOf('[data-testid="post-card"]'))
    await browser.eval(`(() => {
      const el = document.querySelector('[data-testid="collection-search"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'a');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await waitFor(async () => (await browser.eval(`location.search`)).includes("q="), {
      label: "q= in the URL",
    })
    await waitFor(async () => (await browser.eval(countOf('[data-testid="post-card"]'))) !== before, {
      label: "results to change after search",
    })
    const after = await browser.eval(countOf('[data-testid="post-card"]'))
    await shot(browser, "collection-search")
    return `${before} → ${after} cards, ${await browser.eval("location.search")}`
  })

  // 5. Sort (DISC-06 / §82 step 9)
  await check("changing sort writes sort= and reorders the first card", async () => {
    const firstHref = () =>
      browser.eval(
        `document.querySelector('[data-testid="post-card"] [data-testid="open-on-x"]')?.getAttribute('href') ?? ""`
      )
    const before = await firstHref()
    await browser.eval(`(() => {
      const el = document.querySelector('[data-testid="collection-sort"]');
      el.value = 'tweet_asc';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    await waitFor(async () => (await browser.eval("location.search")).includes("sort=tweet_asc"), {
      label: "sort= in the URL",
    })
    await waitFor(async () => (await firstHref()) !== before, { label: "reordering" })
    return `sort=tweet_asc, first card changed`
  })

  // 6. Filter (DISC-02/03 / §82 steps 10-12)
  await check("filter opens a popover on desktop and applies a quick range", async () => {
    await browser.click('[data-testid="collection-filter"]')
    await browser.waitForExpr(exists('[data-testid="filter-popover"]'), { label: "filter popover" })
    await shot(browser, "filter-popover")
    // pick the "Last 7 Days" quick range, then Apply
    const presetClicked = await browser.eval(`(() => {
      const panel = document.querySelector('[data-testid="filter-panel"]');
      const btn = [...panel.querySelectorAll('button')].find(b => /7\\s*days/i.test(b.textContent));
      if (!btn) return false; btn.click(); return true;
    })()`)
    if (!presetClicked) throw new Error("quick-range preset not found in the panel")
    await browser.click('[data-testid="filter-apply"]')
    await waitFor(async () => (await browser.eval("location.search")).includes("saved_from"), {
      label: "saved_from in the URL after Apply",
    })
    const active = await browser.eval(exists('[data-testid="collection-filter-dot"]'))
    if (!active) throw new Error("filter-active indicator did not appear")
    await shot(browser, "filter-applied")
    return await browser.eval("location.search")
  })

  // 7. Infinite scroll (§82 step 14) — needs >30 posts in the collection
  await check("infinite scroll appends a page at the sentinel, or the dataset is a single page", async () => {
    const total = await browser.eval(countOf('[data-testid="post-card"]'))
    const sentinel = await browser.eval(exists('[data-testid="infinite-sentinel"]'))
    if (!sentinel) throw new Error("sentinel missing")
    if (total < 30) return `single page (${total} cards) — no paging expected`
    await browser.eval(`window.scrollTo(0, document.body.scrollHeight); true`)
    await waitFor(async () => (await browser.eval(countOf('[data-testid="post-card"]'))) > total, {
      label: "another page to append",
    })
    return `${total} → ${await browser.eval(countOf('[data-testid="post-card"]'))} cards`
  })

  // 8. Lightbox (§82 steps 16-21, LIGHT-01..06)
  await check("lightbox opens from a media tile and shows a counter", async () => {
    await browser.eval(`window.scrollTo(0, 0); true`)
    const hasMedia = await browser.eval(exists('[data-testid="post-media-trigger"]'))
    if (!hasMedia) throw new Error("no media trigger on the page")
    await browser.click('[data-testid="post-media-trigger"]')
    await browser.waitForExpr(exists('[data-testid="media-lightbox"]'), { label: "lightbox dialog" })
    const counter = await browser.eval(textOf('[data-testid="lightbox-counter"]'))
    if (!/^\d+\s*\/\s*\d+$/.test(counter)) throw new Error(`unexpected counter text: ${counter}`)
    const src = await browser.eval(
      `document.querySelector('[data-testid="lightbox-media-area"] img')?.getAttribute('src') ?? ""`
    )
    if (!src.includes("pbs.twimg.com")) throw new Error(`lightbox image is not the stored URL: ${src}`)
    await shot(browser, "lightbox-open")
    return counter
  })

  await check("ArrowRight advances the lightbox", async () => {
    const before = await browser.eval(textOf('[data-testid="lightbox-counter"]'))
    await browser.press("ArrowRight")
    await waitFor(async () => (await browser.eval(textOf('[data-testid="lightbox-counter"]'))) !== before, {
      label: "counter to advance",
    })
    return `${before} → ${await browser.eval(textOf('[data-testid="lightbox-counter"]'))}`
  })

  await check("lightbox Open on X is a safe new-tab link", async () => {
    const attrs = await browser.eval(`(() => {
      const a = document.querySelector('[data-testid="lightbox-open-on-x"]');
      if (!a) return null;
      return { tag: a.tagName, target: a.getAttribute('target'), rel: a.getAttribute('rel'), href: a.getAttribute('href') };
    })()`)
    if (!attrs) throw new Error("Open on X missing in the lightbox")
    if (attrs.target !== "_blank") throw new Error(`target is ${attrs.target}`)
    if (!/noopener/.test(attrs.rel ?? "") || !/noreferrer/.test(attrs.rel ?? "")) {
      throw new Error(`rel is ${attrs.rel}`)
    }
    return `${attrs.tag} rel="${attrs.rel}"`
  })

  await check("Escape closes the lightbox and restores focus to the media tile", async () => {
    await browser.press("Escape")
    await waitFor(async () => !(await browser.eval(exists('[data-testid="media-lightbox"]'))), {
      label: "lightbox to close",
    })
    await new Promise((r) => setTimeout(r, 150))
    const focused = await browser.eval(
      `document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? ''`
    )
    if (focused !== "post-media-trigger") {
      throw new Error(`focus not restored to the trigger (activeElement: ${focused})`)
    }
    return "focus restored to post-media-trigger"
  })

  // 9. Responsive (HARD-03 / §82 step 23)
  await check("masonry column count adapts across desktop, tablet and mobile", async () => {
    const read = async (w, h) => {
      await browser.viewport(w, h)
      await new Promise((r) => setTimeout(r, 250))
      return Number(
        await browser.eval(
          `document.querySelector('[data-testid="gallery-masonry"]')?.getAttribute('data-columns') ?? 0`
        )
      )
    }
    const desktop = await read(1440, 1100)
    await shot(browser, "responsive-desktop")
    const tablet = await read(900, 1100)
    await shot(browser, "responsive-tablet")
    const mobile = await read(390, 900)
    await shot(browser, "responsive-mobile")
    if (mobile !== 1) throw new Error(`expected 1 column at 390px, got ${mobile}`)
    if (!(desktop >= tablet && tablet >= mobile)) {
      throw new Error(`columns not monotonically decreasing: ${desktop}/${tablet}/${mobile}`)
    }
    return `1440px=${desktop}, 900px=${tablet}, 390px=${mobile}`
  })

  await check("filter becomes a Sheet on a narrow viewport", async () => {
    await browser.viewport(390, 900)
    await new Promise((r) => setTimeout(r, 250))
    await browser.click('[data-testid="collection-filter"]')
    await browser.waitForExpr(exists('[data-testid="filter-sheet"]'), { label: "filter sheet" })
    const hasPopover = await browser.eval(exists('[data-testid="filter-popover"]'))
    if (hasPopover) throw new Error("desktop popover rendered at mobile width")
    await shot(browser, "filter-sheet")
    await browser.press("Escape")
    return "sheet rendered, no popover"
  })

  // 10. No runtime errors
  await check("no uncaught errors or console.error during the whole run", async () => {
    const errors = await browser.consoleErrors()
    const real = errors.filter((e) => !/ResizeObserver loop/i.test(e))
    if (real.length) throw new Error(`${real.length} page error(s): ${real.slice(0, 3).join(" | ")}`)
    return "clean"
  })
})

const failed = results.filter((r) => !r.ok)
console.log(`\n=== browser acceptance: ${results.length - failed.length} passed, ${failed.length} failed ===`)
console.log(`screenshots: ${OUT}`)
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.detail}`)
  process.exit(1)
}
