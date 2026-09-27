package storage

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// FilenamePattern is the only filename shape the backend accepts. The
// extension is responsible for slugging category names; the backend never
// generates or repairs a filename.
var FilenamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*\.csv$`)

// maxFilenameLen keeps names comfortably inside common filesystem limits
// (NAME_MAX is 255 on Linux).
const maxFilenameLen = 255

// ValidateFilename reports whether name is a safe per-category CSV filename.
//
// Defense in depth: explicit traversal/separator/NUL checks run before the
// regex, then the regex enforces the full allowed shape.
func ValidateFilename(name string) error {
	switch {
	case name == "":
		return &ValidationError{Reason: "filename is required"}
	case len(name) > maxFilenameLen:
		return &ValidationError{Reason: "filename is too long"}
	case strings.ContainsRune(name, 0):
		return &ValidationError{Reason: "filename must not contain NUL"}
	case strings.ContainsAny(name, `/\`):
		return &ValidationError{Reason: "filename must not contain path separators"}
	case strings.Contains(name, ".."):
		return &ValidationError{Reason: "filename must not contain .."}
	case strings.Contains(name, "~"):
		return &ValidationError{Reason: "filename must not contain ~"}
	case filepath.IsAbs(name):
		return &ValidationError{Reason: "filename must be relative"}
	case name != filepath.Base(name) || name != filepath.Clean(name):
		return &ValidationError{Reason: "filename must be a plain file name"}
	}
	if !FilenamePattern.MatchString(name) {
		return &ValidationError{
			Reason: fmt.Sprintf("filename must match %s", FilenamePattern.String()),
		}
	}
	return nil
}

// SafeJoin validates name and joins it onto dir, asserting the result stays
// inside dir.
func SafeJoin(dir, name string) (string, error) {
	if err := ValidateFilename(name); err != nil {
		return "", err
	}
	joined := filepath.Join(dir, name)
	rel, err := filepath.Rel(dir, joined)
	if err != nil {
		return "", &ValidationError{Reason: "filename escapes the storage directory"}
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", &ValidationError{Reason: "filename escapes the storage directory"}
	}
	return joined, nil
}
