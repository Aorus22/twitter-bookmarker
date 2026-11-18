import { describe, expect, it } from "vitest"

import { isNsfwCollection, isNsfwTitle } from "./nsfw"

describe("isNsfwTitle", () => {
  it("matches the marker case-insensitively, anywhere in the title", () => {
    expect(isNsfwTitle("NSFW")).toBe(true)
    expect(isNsfwTitle("nsfw art")).toBe(true)
    expect(isNsfwTitle("Gifs (NSFW)")).toBe(true)
    expect(isNsfwTitle("nsfw_art")).toBe(true)
  })

  it("leaves ordinary titles alone", () => {
    expect(isNsfwTitle("Coding")).toBe(false)
    expect(isNsfwTitle("")).toBe(false)
  })
})

describe("isNsfwCollection", () => {
  it("reads the name", () => {
    expect(isNsfwCollection({ slug: "sketchy", name: "Sketchy (NSFW)" })).toBe(
      true
    )
  })

  it("falls back to the slug when the name is blank", () => {
    expect(isNsfwCollection({ slug: "nsfw-dump", name: "" })).toBe(true)
    expect(isNsfwCollection({ slug: "linux", name: "   " })).toBe(false)
  })
})
