import { describe, expect, it } from "vitest"

import { formatPostMeta } from "./post-meta"

const NOW = new Date(2026, 3, 3, 12, 0, 0)

describe("formatPostMeta (PRD-2 §23, design spec §3.3)", () => {
  it("renders the tweet date with its year and the short saved date", () => {
    expect(
      formatPostMeta(
        {
          tweet_date: new Date(2026, 2, 12, 12, 0, 0).toISOString(),
          saved_at: new Date(2026, 3, 3, 12, 0, 0).toISOString(),
        },
        { now: NOW, locale: "en-US" }
      )
    ).toBe("Mar 12, 2026 · Saved Apr 3")
  })

  it("adds the saved date's year when it is not from the current year", () => {
    expect(
      formatPostMeta(
        {
          tweet_date: new Date(2025, 11, 24, 12, 0, 0).toISOString(),
          saved_at: new Date(2025, 11, 27, 12, 0, 0).toISOString(),
        },
        { now: NOW, locale: "en-US" }
      )
    ).toBe("Dec 24, 2025 · Saved Dec 27, 2025")
  })

  it("drops a missing date instead of printing Invalid Date", () => {
    expect(formatPostMeta({ tweet_date: "", saved_at: "" })).toBe("")
    expect(
      formatPostMeta(
        {
          tweet_date: new Date(2026, 2, 12, 12, 0, 0).toISOString(),
          saved_at: "not-a-date",
        },
        { now: NOW, locale: "en-US" }
      )
    ).toBe("Mar 12, 2026")
  })
})
