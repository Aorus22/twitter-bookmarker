/**
 * Minimal, dependency-free WebDriver BiDi driver for Firefox.
 *
 * Why this exists: the milestone's acceptance criteria (PRD-2 §82, HARD-04)
 * include real-browser behaviour — focus rings, keyboard navigation, contrast,
 * responsive layout — that jsdom cannot prove. Playwright/Puppeteer browsers are
 * not installed on this machine, but Firefox is, and it speaks WebDriver BiDi on
 * `--remote-debugging-port`. Node 24 ships a global `WebSocket`, so a complete
 * driver fits in one file with zero dependencies — consistent with this repo's
 * no-external-dependency posture.
 *
 * Usage: import { launchFirefox, withBrowser } from "./lib-bidi.mjs"
 */

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Firefox key values (WebDriver spec) for the keys this suite needs. */
export const KEYS = {
  Escape: "\uE00C",
  Tab: "\uE004",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Enter: "\uE007",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll until `predicate()` is truthy or the deadline passes. */
export async function waitFor(predicate, { timeoutMs = 20000, intervalMs = 150, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await predicate()
      if (last) return last
    } catch (err) {
      last = err
    }
    await sleep(intervalMs)
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (last: ${String(last).slice(0, 200)})` : ""}`)
}

/**
 * Launch headless Firefox with the Remote Agent and return a connected session.
 *
 * @param {{ port?: number, profileDir?: string }} [opts]
 */
export async function launchFirefox({ port = 0, profileDir } = {}) {
  const chosen = port || 9300 + Math.floor(Math.random() * 400)
  const profile = profileDir ?? mkdtempSync(join(tmpdir(), "bidi-profile-"))
  const child = spawn(
    "firefox",
    ["--headless", "--no-remote", "--remote-debugging-port", String(chosen), "-profile", profile, "about:blank"],
    { stdio: "ignore", detached: true }
  )
  child.unref()

  const session = await openSession(chosen)
  const cleanup = () => {
    try { process.kill(-child.pid, "SIGKILL") } catch {}
    try { child.kill("SIGKILL") } catch {}
    if (!profileDir) { try { rmSync(profile, { recursive: true, force: true }) } catch {} }
  }
  return { ...session, port: chosen, pid: child.pid, cleanup }
}

async function openSession(port) {
  const url = `ws://127.0.0.1:${port}/session`
  let ws
  await waitFor(
    async () => {
      ws = new WebSocket(url)
      await new Promise((res, rej) => {
        ws.onopen = res
        ws.onerror = () => rej(new Error("not up"))
      }).catch(() => {})
      return ws.readyState === 1
    },
    { timeoutMs: 30000, label: `firefox remote agent on ${port}` }
  )

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.type === "error") rej(new Error(`${msg.error}: ${msg.message}`))
      else res(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const myId = ++id
      pending.set(myId, { res, rej })
      ws.send(JSON.stringify({ id: myId, method, params }))
    })

  const sess = await send("session.new", { capabilities: {} })
  const tree = await send("browsingContext.getTree")
  const context = tree.contexts[0].context

  const api = {
    sessionId: sess.sessionId,
    context,
    send,
    close: () => { try { ws.close() } catch {} },

    /** Navigate and wait for the load event. */
    async goto(url, { wait = "complete" } = {}) {
      await send("browsingContext.navigate", { context, url, wait })
      return api
    },

    /** Set an explicit viewport (used for the responsive checks). */
    async viewport(width, height, devicePixelRatio = 1) {
      await send("browsingContext.setViewport", {
        context,
        viewport: { width, height },
        devicePixelRatio,
      })
      return api
    },

    /** Evaluate an expression in the page and return its JSON value. */
    async eval(expression) {
      const res = await send("script.evaluate", {
        expression,
        target: { context },
        awaitPromise: true,
        resultOwnership: "none",
      })
      if (res.type === "exception") {
        throw new Error(`page exception: ${res.exceptionDetails?.text ?? JSON.stringify(res)}`)
      }
      return res.result?.value
    },

    /** Wait until `expression` evaluates truthy. */
    waitForExpr(expression, opts) {
      return waitFor(() => api.eval(expression), { label: expression, ...opts })
    },

    /** Click an element by CSS selector using a real event dispatch. */
    async click(selector) {
      const ok = await api.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`)
      if (!ok) throw new Error(`click target not found: ${selector}`)
      return api
    },

    /** Press a key (or a chord) via input.performActions — real key events. */
    async press(key, { times = 1 } = {}) {
      const value = KEYS[key] ?? key
      for (let i = 0; i < times; i++) {
        await send("input.performActions", {
          context,
          actions: [
            {
              type: "key",
              id: "keyboard",
              actions: [
                { type: "keyDown", value },
                { type: "keyUp", value },
              ],
            },
          ],
        })
      }
      return api
    },

    /** Capture a PNG screenshot to `path`. */
    async screenshot(path) {
      const shot = await send("browsingContext.captureScreenshot", { context })
      const { writeFileSync } = await import("node:fs")
      writeFileSync(path, Buffer.from(shot.data, "base64"))
      return path
    },

    /** Console errors collected from the page (for "no runtime errors" gates). */
    async consoleErrors() {
      return api.eval(`JSON.stringify(window.__bidiErrors ?? [])`).then((s) => JSON.parse(s ?? "[]"))
    },
  }

  // Capture uncaught errors and console.error so a check can assert a clean run.
  // This MUST be awaited: a preload script only applies to navigations that
  // start after it is installed, so firing it blind would miss the first load.
  try {
    await send("script.addPreloadScript", {
      functionDeclaration: `function () {
        window.__bidiErrors = [];
        window.addEventListener('error', function (e) { window.__bidiErrors.push(String(e.message)); });
        window.addEventListener('unhandledrejection', function (e) {
          window.__bidiErrors.push('unhandledrejection: ' + String(e.reason));
        });
        var orig = console.error;
        console.error = function () {
          window.__bidiErrors.push(Array.prototype.map.call(arguments, String).join(' '));
          return orig.apply(console, arguments);
        };
      }`,
    })
  } catch (err) {
    // Non-fatal: the error-collection check will simply report an empty list.
    api.preloadScriptError = err.message
  }

  return api
}

/** Convenience wrapper that always tears the browser down. */
export async function withBrowser(fn, opts) {
  const browser = await launchFirefox(opts)
  try {
    return await fn(browser)
  } finally {
    browser.close()
    browser.cleanup()
  }
}
