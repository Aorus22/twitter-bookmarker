package gallery

import (
	"sort"
	"strings"
	"time"
	"unicode"
)

// csvExt is the only extension a collection file may carry.
const csvExt = ".csv"

// initialisms are the filename tokens that the PRD-2 §7 display-name contract
// spells in upper case: `ai-and-llm.csv` becomes "AI And LLM", not "Ai And
// Llm". Filenames only contain lower-case characters, so an exact match is
// enough. Everything else is ordinary title case, so `linux.csv` is "Linux".
var initialisms = map[string]string{
	"ai":  "AI",
	"llm": "LLM",
}

// DisplayName turns a collection filename into its human-readable name using
// the filename alone: strip `.csv`, collapse `-`/`_` runs into a space and
// title-case every word (PRD-2 §7, GAL-02). No extension category config is
// consulted and renamed categories are never merged.
func DisplayName(filename string) string {
	base := strings.TrimSuffix(filename, csvExt)
	words := strings.FieldsFunc(base, func(r rune) bool { return r == '-' || r == '_' })
	for i, word := range words {
		if upper, ok := initialisms[word]; ok {
			words[i] = upper
			continue
		}
		words[i] = titleWord(word)
	}
	return strings.Join(words, " ")
}

// titleWord upper-cases the first rune and lower-cases the rest.
func titleWord(word string) string {
	runes := []rune(word)
	if len(runes) == 0 {
		return word
	}
	runes[0] = unicode.ToUpper(runes[0])
	for i := 1; i < len(runes); i++ {
		runes[i] = unicode.ToLower(runes[i])
	}
	return string(runes)
}

// collectionSummary is a Collection plus the parsed maximum saved_at used for
// ordering. Keeping the timestamp out of the exported type leaves Collection a
// plain value type.
type collectionSummary struct {
	collection Collection
	lastSaved  time.Time
	hasLast    bool
}

// summarize computes the GAL-04 fields for one parsed file.
func summarize(filename string, rows []parsedRow) collectionSummary {
	summary := collectionSummary{
		collection: Collection{
			Filename:   filename,
			Name:       DisplayName(filename),
			PostCount:  len(rows),
			CoverMedia: []string{},
		},
	}

	for _, row := range rows {
		summary.collection.MediaCount += len(row.post.Media)
		if !summary.hasLast || row.savedTime.After(summary.lastSaved) {
			summary.lastSaved = row.savedTime
			summary.hasLast = true
		}
	}
	if summary.hasLast {
		stamp := summary.lastSaved.UTC().Format(time.RFC3339)
		summary.collection.LastSavedAt = &stamp
	}

	// Cover media: walk the rows newest-saved first and flatten their media
	// arrays until CoverMediaLimit URLs are collected (PRD-2 §17/§39).
	if len(rows) > 0 {
		newest := make([]parsedRow, len(rows))
		copy(newest, rows)
		sort.SliceStable(newest, func(i, j int) bool {
			a := keyOf(newest[i], SortSavedDesc)
			b := keyOf(newest[j], SortSavedDesc)
			return cmpKeys(a, b, SortSavedDesc) < 0
		})
		for _, row := range newest {
			for _, media := range row.post.Media {
				if len(summary.collection.CoverMedia) >= CoverMediaLimit {
					break
				}
				summary.collection.CoverMedia = append(summary.collection.CoverMedia, media)
			}
			if len(summary.collection.CoverMedia) >= CoverMediaLimit {
				break
			}
		}
	}

	return summary
}

// sortSummaries orders collections by last_saved_at DESC with timestamp-less
// collections last; the filename is the deterministic tie-break (GAL-03).
func sortSummaries(summaries []collectionSummary) {
	sort.SliceStable(summaries, func(i, j int) bool {
		a, b := summaries[i], summaries[j]
		switch {
		case !a.hasLast && !b.hasLast:
			return a.collection.Filename < b.collection.Filename
		case !a.hasLast:
			return false
		case !b.hasLast:
			return true
		}
		if a.lastSaved.Equal(b.lastSaved) {
			return a.collection.Filename < b.collection.Filename
		}
		return a.lastSaved.After(b.lastSaved)
	})
}
