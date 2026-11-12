package storage

import (
	"fmt"
	"strings"
	"unicode"
)

// Slug generation. The backend now owns a category's slug, because the backend
// owns the category: POST /v1/collections accepts a name and the backend derives
// the key, so every client — the browser extension, the phone, a curl script —
// produces the same slug for the same name instead of each carrying its own rules.
//
// The rules mirror extension/src/shared/slug.ts and the phone's Slug.java:
// lowercase, trim, whitespace to "-", drop anything outside [a-z0-9-], collapse
// "-" runs, trim leading/trailing "-". A precomposed accented letter keeps its
// base letter ("Café" becomes "cafe"), which is what the clients get from NFKD
// decomposition: they decompose the letter and then drop the combining mark, so
// the mark never reaches the character filter. Here the letter is mapped to its
// base directly. A letter whose decomposition is not a base letter plus a mark
// ("ø", the "ﬁ" ligature) is dropped instead of invented, which is the one place
// this and the clients can disagree.

// asciiPairs decomposes the precomposed Latin letters that a category name is
// realistically typed with: each of these becomes the ASCII letter it is built
// from. Everything else non-ASCII is dropped, exactly like the clients' character
// filter drops the combining mark NFKD left behind.
//
// It is a table rather than a Unicode normalisation call because the standard
// library has no NFD/NFKD and this is the whole of what the rule needs.
var asciiPairs = map[rune]string{
	'À': "A", 'Á': "A", 'Â': "A", 'Ã': "A", 'Ä': "A", 'Å': "A",
	'à': "a", 'á': "a", 'â': "a", 'ã': "a", 'ä': "a", 'å': "a",
	'Ç': "C", 'ç': "c", 'È': "E", 'É': "E", 'Ê': "E", 'Ë': "E",
	'è': "e", 'é': "e", 'ê': "e", 'ë': "e", 'Ì': "I", 'Í': "I",
	'Î': "I", 'Ï': "I", 'ì': "i", 'í': "i", 'î': "i", 'ï': "i",
	'Ñ': "N", 'ñ': "n", 'Ò': "O", 'Ó': "O", 'Ô': "O", 'Õ': "O",
	'Ö': "O", 'Ø': "O", 'ò': "o", 'ó': "o", 'ô': "o", 'õ': "o",
	'ö': "o", 'ø': "o", 'Ù': "U", 'Ú': "U", 'Û': "U", 'Ü': "U",
	'ù': "u", 'ú': "u", 'û': "u", 'ü': "u", 'Ý': "Y", 'ý': "y",
	'ÿ': "y", 'Ÿ': "Y", 'ẞ': "SS", 'ß': "ss",
}

// Slugify converts a human name into the slug the rest of the backend accepts.
//
// An empty result is an error, not a fallback: a name made entirely of
// punctuation ("!!!") has no key to store, and inventing one would hide the
// problem instead of asking the user for a usable name.
func Slugify(name string) (string, error) {
	var b strings.Builder
	b.Grow(len(name))

	lastDash := false
	writeASCII := func(value string) {
		for _, r := range value {
			lowered := unicode.ToLower(r)
			switch {
			case lowered >= 'a' && lowered <= 'z', lowered >= '0' && lowered <= '9':
				b.WriteRune(lowered)
				lastDash = false
			case lowered == '-':
				if b.Len() > 0 && !lastDash {
					b.WriteByte('-')
					lastDash = true
				}
			}
		}
	}

	for _, r := range name {
		// Drop combining marks wherever they appear, which is what turns a name
		// that arrived already decomposed back into its base letters.
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsSpace(r) {
			if b.Len() > 0 && !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
			continue
		}
		if base, ok := asciiPairs[r]; ok {
			writeASCII(base)
			continue
		}
		writeASCII(string(r))
	}

	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return "", &ValidationError{Reason: "name must contain at least one letter or digit"}
	}
	if len(slug) > maxSlugLen {
		return "", &ValidationError{Reason: fmt.Sprintf("name produces a slug longer than %d characters", maxSlugLen)}
	}
	if err := ValidateSlug(slug); err != nil {
		return "", err
	}
	return slug, nil
}
