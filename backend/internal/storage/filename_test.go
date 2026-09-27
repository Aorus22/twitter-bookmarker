package storage_test

import (
	"path/filepath"
	"strings"
	"testing"

	"twitter-bookmarker/internal/storage"
)

func TestValidateFilename(t *testing.T) {
	valid := []string{
		"linux.csv",
		"ai-llm.csv",
		"a.csv",
		"0.csv",
		"read-later.csv",
		"abc123-def456.csv",
		"x.csv",
		"a-1-b-2.csv",
	}
	for _, name := range valid {
		if err := storage.ValidateFilename(name); err != nil {
			t.Errorf("ValidateFilename(%q) = %v, want nil", name, err)
		}
	}

	invalid := []string{
		"",
		"../x.csv",
		"/etc/passwd",
		"~/x.csv",
		"a/b.csv",
		`a\b.csv`,
		"Linux.csv",
		"foo.txt",
		"foo..csv",
		"-foo.csv",
		".csv",
		"foo.CSV",
		"foo.csv ",
		"..",
		"a/../b.csv",
		"foo bar.csv",
		"foo\x00.csv",
		"category-<id>.csv",
		"a/b/../c.csv",
		"con.csv\n",
		"x.csv/",
	}
	for _, name := range invalid {
		if err := storage.ValidateFilename(name); err == nil {
			t.Errorf("ValidateFilename(%q) = nil, want error", name)
		}
	}
}

// TestBackendDoesNotSlugFilenames proves the backend never slugifies category
// names: that is the extension's job. Anything that is not already a safe
// filename is rejected outright.
func TestBackendDoesNotSlugFilenames(t *testing.T) {
	unslugged := []string{"Linux", "AI & LLM", "Read Later", "linux", "ai llm.csv", "Linux.csv", "READ_LATER.csv"}
	for _, name := range unslugged {
		if err := storage.ValidateFilename(name); err == nil {
			t.Errorf("ValidateFilename(%q) = nil, want rejection (backend must not slug)", name)
		}
	}
	slugs := map[string]string{
		"Linux":      "linux.csv",
		"AI & LLM":   "ai-llm.csv",
		"Read Later": "read-later.csv",
	}
	for _, slug := range slugs {
		if err := storage.ValidateFilename(slug); err != nil {
			t.Errorf("ValidateFilename(%q) = %v, want nil", slug, err)
		}
	}
}

func TestSafeJoinStaysInsideDir(t *testing.T) {
	dir := t.TempDir()

	got, err := storage.SafeJoin(dir, "linux.csv")
	if err != nil {
		t.Fatalf("SafeJoin() error = %v", err)
	}
	if filepath.Dir(got) != dir {
		t.Fatalf("SafeJoin() = %q, want parent %q", got, dir)
	}
	if !strings.HasPrefix(got, dir+string(filepath.Separator)) {
		t.Fatalf("SafeJoin() = %q escaped %q", got, dir)
	}

	for _, bad := range []string{"../x.csv", "/etc/passwd", "~/x.csv", "a/b.csv", `a\b.csv`, "..", "", "Linux.csv"} {
		if _, err := storage.SafeJoin(dir, bad); err == nil {
			t.Errorf("SafeJoin(%q) = nil error, want rejection", bad)
		}
	}
}
