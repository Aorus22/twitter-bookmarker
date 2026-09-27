import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

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
})

// jsdom has no layout engine and therefore no `scrollIntoView`; the hero CTA
// would throw if a test ever clicks it. Provide a no-op.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {}
}
