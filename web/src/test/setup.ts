import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

import {
  installIntersectionObserver,
  resetIntersectionObservers,
} from "./intersection-observer"

/**
 * Test setup entry point — referenced by `vitest.config.ts` `setupFiles`.
 *
 * Adds the jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`, …) to
 * vitest's `expect`, unmounts React trees between tests, and removes any
 * `fetch`/global stub a test installed so one mocked network failure can never
 * leak into the next test.
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetIntersectionObservers()
})

// jsdom has no layout engine and therefore no `scrollIntoView`; the hero CTA
// would throw if a test ever clicks it. Provide a no-op.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom's `window.scrollTo` is "not implemented" and logs a virtual-console
// error on every call. The query-change scroll (PRD-2 §77) is asserted with an
// explicit `vi.spyOn(window, "scrollTo")` in the tests that care, so a plain
// no-op here keeps every other test's output clean without hiding the call.
window.scrollTo = () => {}

// Radix (the Phase 6 Popover/Sheet surfaces) observes its content size and
// captures pointers, neither of which jsdom implements. Both are inert stubs:
// the surfaces' presence and behaviour are what the tests assert.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {}
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {}
}

// Phase 7's infinite scroll observes a sentinel with `IntersectionObserver`,
// which jsdom does not implement at all. Installed unconditionally so the suite
// never depends on a future jsdom gaining a real (and untriggerable) one; the
// stub exposes `emit()` for tests and is reset in `afterEach` above.
installIntersectionObserver()
