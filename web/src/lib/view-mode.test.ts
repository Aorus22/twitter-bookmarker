import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_VIEW_MODE,
  VIEW_MODE_STORAGE_KEY,
  parseViewMode,
  readStoredViewMode,
  viewModeLabel,
  writeStoredViewMode,
} from "./view-mode"

beforeEach(() => {
  window.localStorage.clear()
})

describe("parseViewMode", () => {
  it("accepts the three modes and degrades everything else", () => {
    expect(parseViewMode("grid")).toBe("grid")
    expect(parseViewMode("rows")).toBe("rows")
    expect(parseViewMode("masonry")).toBe("masonry")
    expect(parseViewMode(null)).toBe(DEFAULT_VIEW_MODE)
    expect(parseViewMode("carousel")).toBe(DEFAULT_VIEW_MODE)
    expect(parseViewMode(3)).toBe(DEFAULT_VIEW_MODE)
  })
})

describe("stored view mode", () => {
  it("round-trips through localStorage", () => {
    writeStoredViewMode("rows")
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("rows")
    expect(readStoredViewMode()).toBe("rows")
  })

  it("defaults when nothing (or garbage) is stored", () => {
    expect(readStoredViewMode()).toBe(DEFAULT_VIEW_MODE)
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "hologram")
    expect(readStoredViewMode()).toBe(DEFAULT_VIEW_MODE)
  })
})

describe("viewModeLabel", () => {
  it("names every mode", () => {
    expect(viewModeLabel("masonry")).toBe("Masonry")
    expect(viewModeLabel("grid")).toBe("Grid")
    expect(viewModeLabel("rows")).toBe("Rows")
  })
})
