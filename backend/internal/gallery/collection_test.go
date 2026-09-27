package gallery_test

import (
	"testing"

	"twitter-bookmarker/internal/gallery"
)

func TestDisplayName(t *testing.T) {
	tests := []struct {
		filename string
		want     string
	}{
		{filename: "ai-and-llm.csv", want: "AI And LLM"},
		{filename: "ai.csv", want: "AI"},
		{filename: "llm.csv", want: "LLM"},
		{filename: "linux.csv", want: "Linux"},
		{filename: "design.csv", want: "Design"},
		{filename: "linux-stuff.csv", want: "Linux Stuff"},
		{filename: "a_b_c.csv", want: "A B C"},
		{filename: "my--cat__name.csv", want: "My Cat Name"},
		{filename: "web3.csv", want: "Web3"},
		// Only the initialisms named by the PRD-2 §7 contract are upper-cased;
		// everything else is ordinary title case.
		{filename: "os.csv", want: "Os"},
	}
	for _, test := range tests {
		t.Run(test.filename, func(t *testing.T) {
			if got := gallery.DisplayName(test.filename); got != test.want {
				t.Errorf("DisplayName(%q) = %q, want %q", test.filename, got, test.want)
			}
		})
	}
}

func TestCollectionsOrderingTieBreaksDeterministically(t *testing.T) {
	dir := t.TempDir()
	same := "2026-09-05T00:00:00Z"
	writeCSV(t, dir, "b-second.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", same, "b"),
	})
	writeCSV(t, dir, "a-first.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/2", `[]`, "A", "@a", "2026-09-01T00:00:00Z", same, "a"),
	})
	writeCSV(t, dir, "z-empty.csv", currentHeader(), nil)
	writeCSV(t, dir, "y-empty.csv", currentHeader(), nil)

	reader, _ := newReader(t, dir)
	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}

	want := []string{"A First", "B Second", "Y Empty", "Z Empty"}
	got := make([]string, 0, len(collections))
	for _, collection := range collections {
		got = append(got, collection.Name)
	}
	if !equalStrings(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}
