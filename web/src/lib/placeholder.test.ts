import { describe, expect, it } from "vitest"

import {
  PLACEHOLDER_GRADIENTS,
  pickPlaceholderGradient,
  placeholderGradientIndex,
} from "./placeholder"

describe("pickPlaceholderGradient", () => {
  it("is deterministic: the same filename always picks the same gradient", () => {
    const first = pickPlaceholderGradient("linux.csv")
    const second = pickPlaceholderGradient("linux.csv")

    expect(first).toEqual(second)
    expect(first.id).toBe("violet-pink")
  })

  it("returns a gradient from the six --grad-ph-* pairs declared by index.css", () => {
    for (const gradient of PLACEHOLDER_GRADIENTS) {
      expect(gradient.cssVar).toBe(`--grad-ph-${gradient.id}`)
      expect(gradient.value).toBe(`var(${gradient.cssVar})`)
    }

    expect(PLACEHOLDER_GRADIENTS.map((gradient) => gradient.id)).toEqual([
      "gold-blue",
      "violet-pink",
      "green-lime",
      "plum-rose",
      "teal-mint",
      "sand-sage",
    ])
  })

  it("distributes different filenames across the palette", () => {
    const filenames = [
      "linux.csv",
      "design.csv",
      "ai.csv",
      "recipes.csv",
      "travel.csv",
      "music.csv",
      "books.csv",
      "workout.csv",
      "finance.csv",
      "garden.csv",
      "movies.csv",
      "quotes.csv",
      "startups.csv",
      "photography.csv",
      "code.csv",
      "health.csv",
      "science.csv",
      "history.csv",
      "art.csv",
      "food.csv",
    ]

    const picked = new Set(
      filenames.map((filename) => pickPlaceholderGradient(filename).id)
    )

    expect(picked.size).toBeGreaterThan(1)
    expect(pickPlaceholderGradient("linux.csv").id).not.toBe(
      pickPlaceholderGradient("design.csv").id
    )
  })

  it("keeps the index inside the palette range", () => {
    for (const key of ["", "a", "linux.csv", "some/very/long-name.csv"]) {
      const index = placeholderGradientIndex(key)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(PLACEHOLDER_GRADIENTS.length)
    }
  })
})
