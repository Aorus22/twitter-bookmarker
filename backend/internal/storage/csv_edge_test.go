package storage_test

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestCSVEdgeCasesRoundTripAndExternalParse proves PRD §65 item 16 (and PRD
// §63/§64): commas, quotes, emoji, unicode, CRLF/LF newlines, empty text and
// long single-line text all survive a save and remain parseable by an external
// CSV parser.
//
// encoding/csv (the writer the backend uses) quotes fields containing commas,
// quotes or newlines; the backend performs no manual escaping.
//
// Note on CRLF: Go's encoding/csv.Reader normalises every \r\n to \n on read
// (documented behaviour). The test therefore asserts the CRLF bytes are
// preserved verbatim on disk and that the parsed value equals the input with
// CRLF normalised to LF; every other case round-trips byte-for-byte.
func TestCSVEdgeCasesRoundTripAndExternalParse(t *testing.T) {
	longText := strings.Repeat(`Long "quoted", 🐧 line — `, 1500)

	tests := []struct {
		name            string
		author          string
		username        string
		text            string
		wantRawContains string
	}{
		{
			name:            "comma_in_author",
			author:          "Foo, Bar",
			username:        "@foo",
			text:            "Testing, Linux today",
			wantRawContains: `"Foo, Bar"`,
		},
		{
			name:            "emoji_and_comma_in_author",
			author:          "Foo, Bar 🐧",
			username:        "@bar",
			text:            "penguin, 🐧 party",
			wantRawContains: `"Foo, Bar 🐧"`,
		},
		{
			name:            "quoted_text",
			author:          "Foo",
			username:        "@foo",
			text:            `He said "hello" and "goodbye"`,
			wantRawContains: `""hello""`,
		},
		{
			name:            "crlf_and_lf_multiline",
			author:          "Foo",
			username:        "@foo",
			text:            "line one\r\nline two\nline three",
			wantRawContains: "line one\r\nline two",
		},
		{
			name:     "cjk_unicode",
			author:   "山田 太郎",
			username: "@yamada",
			text:     "これはテストです。東京タワー 🗼 からこんにちは",
		},
		{
			name:     "rtl_unicode",
			author:   "محمد الأحمد",
			username: "@mohammed",
			text:     "مرحبا بالعالم\nשלום עולם",
		},
		{
			name:     "empty_text_media_only",
			author:   "Foo",
			username: "@foo",
			text:     "",
		},
		{
			name:     "long_single_line",
			author:   "Foo",
			username: "@foo",
			text:     longText,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store, _, dir := newTestStore(t)

			req := saveReq("linux.csv", "https://x.com/foo/status/123?s=20", tc.text)
			req.Tweet.Author = tc.author
			req.Tweet.Username = tc.username

			resp, err := store.Save(req)
			if err != nil {
				t.Fatalf("Save() error = %v", err)
			}
			if resp.URL != "https://x.com/foo/status/123" {
				t.Errorf("response url = %q, want canonical", resp.URL)
			}
			if resp.TweetID != "123" {
				t.Errorf("response tweet_id = %q, want 123", resp.TweetID)
			}

			path := filepath.Join(dir, "linux.csv")
			rows := dataRows(t, dir, "linux.csv")
			if len(rows) != 1 {
				t.Fatalf("data rows = %d, want 1", len(rows))
			}
			row := rows[0]
			if len(row) != 7 {
				t.Fatalf("field count = %d, want 7: %q", len(row), row)
			}

			// encoding/csv normalises CRLF to LF on read; every other byte
			// must round-trip exactly.
			wantText := strings.ReplaceAll(tc.text, "\r\n", "\n")
			if row[0] != resp.URL {
				t.Errorf("url field = %q, want %q", row[0], resp.URL)
			}
			if row[1] != "[]" {
				t.Errorf("media field = %q, want []", row[1])
			}
			if row[2] != tc.author {
				t.Errorf("author field = %q, want %q", row[2], tc.author)
			}
			if row[3] != tc.username {
				t.Errorf("username field = %q, want %q", row[3], tc.username)
			}
			if row[4] != "2026-09-27T01:00:00Z" {
				t.Errorf("tweet_date field = %q, want 2026-09-27T01:00:00Z", row[4])
			}
			if row[5] != resp.SavedAt {
				t.Errorf("saved_at field = %q, want %q", row[5], resp.SavedAt)
			}
			if row[6] != wantText {
				t.Errorf("text field = %q, want %q", row[6], wantText)
			}

			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read csv: %v", err)
			}
			if tc.wantRawContains != "" && !strings.Contains(string(raw), tc.wantRawContains) {
				t.Errorf("raw CSV does not contain %q; got:\n%s", tc.wantRawContains, raw)
			}
			if tc.name == "long_single_line" {
				// Only the header terminator and the row terminator: the long
				// text itself must not introduce a line break.
				if got := strings.Count(string(raw), "\n"); got != 2 {
					t.Errorf("long single-line file has %d newlines, want 2 (header + row terminators)", got)
				}
			}

			// An external parser must accept the file with strict quoting and
			// exactly 7 fields per record.
			want := [][]string{
				{"url", "media", "author", "username", "tweet_date", "saved_at", "text"},
				{resp.URL, "[]", tc.author, tc.username, "2026-09-27T01:00:00Z", resp.SavedAt, tc.text},
			}
			assertExternalParserReads(t, path, want)
		})
	}
}

// assertExternalParserReads validates path with python3's csv module when
// available (strict quoting, embedded newlines preserved), otherwise with Go's
// encoding/csv in strict FieldsPerRecord mode.
func assertExternalParserReads(t *testing.T, path string, want [][]string) {
	t.Helper()

	python, err := exec.LookPath("python3")
	if err != nil {
		t.Log("python3 not found; falling back to Go encoding/csv with strict FieldsPerRecord")
		got, err := readCSVStrictGo(path)
		if err != nil {
			t.Fatalf("Go strict csv.Reader could not parse %s: %v", path, err)
		}
		compareRowsNormalized(t, "go strict csv.Reader", got, want)
		return
	}

	got, err := readCSVWithPython(python, path)
	if err != nil {
		t.Fatalf("python3 csv module could not parse %s: %v", path, err)
	}
	compareRowsNormalized(t, "python3 csv", got, want)
}

func readCSVWithPython(python, path string) ([][]string, error) {
	const script = `import csv, json, sys
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    rows = list(csv.reader(f, strict=True))
if any(len(r) != 7 for r in rows):
    sys.exit("every record must have exactly 7 fields")
print(json.dumps(rows))
`
	cmd := exec.Command(python, "-c", script, path)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, bytes.TrimSpace(out))
	}
	var rows [][]string
	if err := json.Unmarshal(out, &rows); err != nil {
		return nil, fmt.Errorf("decode python csv output %q: %w", out, err)
	}
	return rows, nil
}

func readCSVStrictGo(path string) ([][]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = 7
	r.LazyQuotes = false
	return r.ReadAll()
}

// compareRowsNormalized compares CSV rows after normalising CRLF to LF, the one
// difference between Go's and Python's readers.
func compareRowsNormalized(t *testing.T, source string, got, want [][]string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s returned %d rows, want %d: %q", source, len(got), len(want), got)
	}
	for i := range want {
		if len(got[i]) != len(want[i]) {
			t.Fatalf("%s row %d has %d fields, want %d: %q", source, i, len(got[i]), len(want[i]), got[i])
		}
		for j := range want[i] {
			g, w := normalizeNewlines(got[i][j]), normalizeNewlines(want[i][j])
			if g != w {
				t.Errorf("%s row %d field %d = %q, want %q", source, i, j, g, w)
			}
		}
	}
}

func normalizeNewlines(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}
