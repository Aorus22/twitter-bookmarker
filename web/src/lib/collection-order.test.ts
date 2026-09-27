import { describe, expect, it } from "vitest"

import { orderCollections } from "./collection-order"
import type { GalleryCollection } from "@/types"

function collection(
  filename: string,
  lastSavedAt: string | null
): GalleryCollection {
  return {
    filename,
    name: filename.replace(/\.csv$/, ""),
    post_count: 1,
    media_count: 0,
    last_saved_at: lastSavedAt,
    cover_media: [],
  }
}

describe("orderCollections", () => {
  it("returns the backend order untouched when every collection has a timestamp", () => {
    const input = [
      collection("b.csv", "2026-09-27T10:00:00Z"),
      collection("a.csv", "2026-09-26T10:00:00Z"),
    ]

    const result = orderCollections(input)

    expect(result).toBe(input)
    expect(result.map((c) => c.filename)).toEqual(["b.csv", "a.csv"])
  })

  it("moves timestamp-less collections after collections with data (PRD-2 §38)", () => {
    const result = orderCollections([
      collection("undated.csv", null),
      collection("newer.csv", "2026-09-27T10:00:00Z"),
      collection("older.csv", "2026-09-26T10:00:00Z"),
    ])

    expect(result.map((c) => c.filename)).toEqual([
      "newer.csv",
      "older.csv",
      "undated.csv",
    ])
  })

  it("keeps the relative order stable inside each group", () => {
    const result = orderCollections([
      collection("u1.csv", null),
      collection("d1.csv", "2026-09-27T10:00:00Z"),
      collection("u2.csv", null),
      collection("d2.csv", "2026-09-25T10:00:00Z"),
    ])

    expect(result.map((c) => c.filename)).toEqual([
      "d1.csv",
      "d2.csv",
      "u1.csv",
      "u2.csv",
    ])
  })

  it("handles the empty list", () => {
    expect(orderCollections([])).toEqual([])
  })
})
