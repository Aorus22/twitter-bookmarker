// Acceptance suite for the backend criteria in PRD.md §65 (items 1-20).
//
// TestPRD65Acceptance locks every criterion that is observable through the HTTP
// API to a named subtest. Criteria whose authoritative proof lives in another
// package (process lifecycle, config, CSV storage, derived index) are mapped
// below to the test that proves them, so this file alone is an auditable index
// of §65 coverage.
//
//	#   §65 acceptance criterion                        Authoritative test(s)
//	1   executable Go runs manually                     cmd/server: TestProcessLiveServer
//	2   server binds loopback only                      config: TestFixedLoopbackAddress;
//	                                                    cmd/server: TestProcessLiveServer (startup log address)
//	3   ~/.twitter-bookmarker/ auto-created (0700)      config: TestEnsureStorageDirCreates0700AndRepairs;
//	                                                    cmd/server: TestProcessLiveServer
//	4   GET /health works                               TestPRD65Acceptance/item04_health
//	5   GET /v1/index works                             TestPRD65Acceptance/item05_index_endpoint
//	6   POST /v1/bookmarks creates the CSV              TestPRD65Acceptance/item06_csv_created_when_missing
//	7   CSV header written exactly once                 TestPRD65Acceptance/item07_header_written_once
//	8   subsequent saves append rows                    TestPRD65Acceptance/item08_subsequent_saves_append
//	9   URL normalized                                  TestPRD65Acceptance/item09_url_normalized
//	10  Tweet ID extracted                              TestPRD65Acceptance/item10_tweet_id_extracted
//	11  saved_at uses UTC                               TestPRD65Acceptance/item11_saved_at_is_utc
//	12  duplicate rejected with 409 (same file)         TestPRD65Acceptance/item12_duplicate_same_file_409
//	13  duplicate detection spans all CSVs              TestPRD65Acceptance/item13_duplicate_cross_file_409
//	14  index rebuildable from CSV                      index: TestRebuildFromTwoCSVsYieldsAllIDs
//	15  malformed index never damages CSV data          index: TestRebuildCorruptIndexYieldsAllIDsAndCSVsByteIdentical
//	16  unicode/newline/comma valid in CSV              storage: TestCSVEdgeCasesRoundTripAndExternalParse
//	17  filename traversal rejected                     TestPRD65Acceptance/item17_filename_traversal_rejected
//	18  concurrent duplicates make exactly one row      storage: TestConcurrentSameTweetExactlyOneRow
//	19  index-persist failure never rolls back CSV      TestPRD65Acceptance/item19_index_persist_failure_still_201
//	20  no settings/categories storage or endpoints     TestPRD65Acceptance/item20_no_categories_or_settings_surface
package api_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"twitter-bookmarker/internal/api"
	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

func TestPRD65Acceptance(t *testing.T) {
	t.Run("item04_health", func(t *testing.T) {
		h, _ := newTestServer(t)
		rec := do(h, http.MethodGet, "/health", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := decode[model.HealthResponse](t, rec).Status; got != "ok" {
			t.Fatalf("status field = %q, want ok", got)
		}
	})

	t.Run("item05_index_endpoint", func(t *testing.T) {
		h, _ := newTestServer(t)

		empty := do(h, http.MethodGet, "/v1/index", "")
		if empty.Code != http.StatusOK {
			t.Fatalf("empty index status = %d, want 200", empty.Code)
		}
		if got := decode[model.IndexResponse](t, empty); got.Items == nil || len(got.Items) != 0 {
			t.Fatalf("empty index items = %+v, want empty non-nil map", got.Items)
		}

		if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
			t.Fatalf("save status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
		}
		rec := do(h, http.MethodGet, "/v1/index", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("index status = %d, want 200", rec.Code)
		}
		items := decode[model.IndexResponse](t, rec).Items
		entry, ok := items["123"]
		if !ok {
			t.Fatalf("index missing tweet 123: %+v", items)
		}
		if entry.URL != "https://x.com/foo/status/123" || entry.Filename != "linux.csv" {
			t.Fatalf("index entry = %+v, want canonical url + linux.csv", entry)
		}
		if _, err := time.Parse(time.RFC3339, entry.SavedAt); err != nil {
			t.Fatalf("index saved_at %q is not RFC3339: %v", entry.SavedAt, err)
		}
	})

	t.Run("item06_csv_created_when_missing", func(t *testing.T) {
		h, dir := newTestServer(t)
		path := filepath.Join(dir, "linux.csv")
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("linux.csv should not exist before the first save (stat err = %v)", err)
		}

		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
		}
		resp := decode[model.SaveResponse](t, rec)
		if resp.Filename != "linux.csv" {
			t.Fatalf("filename = %q, want linux.csv", resp.Filename)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("linux.csv was not created: %v", err)
		}
		first := strings.SplitN(strings.TrimRight(string(raw), "\r\n"), "\n", 2)[0]
		if first != storage.Header {
			t.Fatalf("csv header = %q, want %q", first, storage.Header)
		}
	})

	t.Run("item07_header_written_once", func(t *testing.T) {
		h, dir := newTestServer(t)
		for _, body := range []string{
			validBody,
			`{"filename":"linux.csv","tweet":{"url":"https://x.com/bar/status/456","author":"Bar","username":"@bar","tweet_date":"2026-09-27T02:00:00Z","text":"second"}}`,
		} {
			if rec := do(h, http.MethodPost, "/v1/bookmarks", body); rec.Code != http.StatusCreated {
				t.Fatalf("save status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
			}
		}

		raw, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
		if err != nil {
			t.Fatalf("read linux.csv: %v", err)
		}
		lines := strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n")
		if lines[0] != storage.Header {
			t.Fatalf("line 1 = %q, want header %q", lines[0], storage.Header)
		}
		headerCount := 0
		for _, line := range lines {
			if line == storage.Header {
				headerCount++
			}
		}
		if headerCount != 1 {
			t.Fatalf("header appeared %d times across %d lines, want exactly 1:\n%s", headerCount, len(lines), raw)
		}
	})

	t.Run("item08_subsequent_saves_append", func(t *testing.T) {
		h, dir := newTestServer(t)
		bodies := []string{
			validBody,
			`{"filename":"linux.csv","tweet":{"url":"https://x.com/bar/status/456","author":"Bar","username":"@bar","tweet_date":"2026-09-27T02:00:00Z","text":"second"}}`,
			`{"filename":"linux.csv","tweet":{"url":"https://x.com/baz/status/789","author":"Baz","username":"@baz","tweet_date":"2026-09-27T03:00:00Z","text":"third"}}`,
		}
		for _, body := range bodies {
			if rec := do(h, http.MethodPost, "/v1/bookmarks", body); rec.Code != http.StatusCreated {
				t.Fatalf("save status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
			}
		}

		rows := csvDataRows(t, dir, "linux.csv")
		if len(rows) != len(bodies) {
			t.Fatalf("data rows = %d, want %d", len(rows), len(bodies))
		}
		gotIDs := []string{rows[0][0], rows[1][0], rows[2][0]}
		wantIDs := []string{
			"https://x.com/foo/status/123",
			"https://x.com/bar/status/456",
			"https://x.com/baz/status/789",
		}
		for i := range wantIDs {
			if gotIDs[i] != wantIDs[i] {
				t.Errorf("row %d url = %q, want %q", i, gotIDs[i], wantIDs[i])
			}
		}
	})

	t.Run("item09_url_normalized", func(t *testing.T) {
		h, dir := newTestServer(t)
		body := `{"filename":"linux.csv","tweet":{"url":"https://twitter.com/foo/status/321?s=20#frag","author":"Foo","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"hi"}}`
		rec := do(h, http.MethodPost, "/v1/bookmarks", body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
		}
		resp := decode[model.SaveResponse](t, rec)
		if resp.URL != "https://x.com/foo/status/321" {
			t.Fatalf("response url = %q, want canonical https://x.com/foo/status/321", resp.URL)
		}
		if row := csvDataRows(t, dir, "linux.csv")[0]; row[0] != resp.URL {
			t.Fatalf("csv url = %q, want canonical %q", row[0], resp.URL)
		}
	})

	t.Run("item10_tweet_id_extracted", func(t *testing.T) {
		h, dir := newTestServer(t)
		body := `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/987654321?s=20","author":"Foo","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"hi"}}`
		rec := do(h, http.MethodPost, "/v1/bookmarks", body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
		}
		resp := decode[model.SaveResponse](t, rec)
		if resp.TweetID != "987654321" {
			t.Fatalf("response tweet_id = %q, want 987654321", resp.TweetID)
		}
		if items := decode[model.IndexResponse](t, do(h, http.MethodGet, "/v1/index", "")).Items; items["987654321"].URL != resp.URL {
			t.Fatalf("index is not keyed by the extracted id: %+v", items)
		}
		if row := csvDataRows(t, dir, "linux.csv")[0]; !strings.HasSuffix(row[0], "/status/987654321") {
			t.Fatalf("csv url = %q, want /status/987654321 suffix", row[0])
		}
	})

	t.Run("item11_saved_at_is_utc", func(t *testing.T) {
		h, dir := newTestServer(t)
		before := time.Now().UTC().Add(-time.Minute)
		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		after := time.Now().UTC().Add(time.Minute)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
		}
		resp := decode[model.SaveResponse](t, rec)

		parsed, err := time.Parse(time.RFC3339, resp.SavedAt)
		if err != nil {
			t.Fatalf("saved_at %q is not RFC3339: %v", resp.SavedAt, err)
		}
		if parsed.Location() != time.UTC {
			t.Fatalf("saved_at location = %v, want UTC", parsed.Location())
		}
		if parsed.Before(before) || parsed.After(after) {
			t.Fatalf("saved_at %v outside [%v, %v]", parsed, before, after)
		}
		if row := csvDataRows(t, dir, "linux.csv")[0]; row[4] != resp.SavedAt {
			t.Fatalf("csv saved_at = %q, response saved_at = %q", row[4], resp.SavedAt)
		}
	})

	t.Run("item12_duplicate_same_file_409", func(t *testing.T) {
		h, dir := newTestServer(t)
		if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
			t.Fatalf("first save status = %d, want 201", rec.Code)
		}
		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		if rec.Code != http.StatusConflict {
			t.Fatalf("duplicate status = %d, want 409 (body %s)", rec.Code, rec.Body.String())
		}
		dup := decode[model.DuplicateResponse](t, rec)
		if dup.Status != "duplicate" || dup.TweetID != "123" {
			t.Fatalf("duplicate body = %+v, want status=duplicate tweet_id=123", dup)
		}
		if rows := csvDataRows(t, dir, "linux.csv"); len(rows) != 1 {
			t.Fatalf("data rows = %d, want 1 after duplicate", len(rows))
		}
	})

	t.Run("item13_duplicate_cross_file_409", func(t *testing.T) {
		h, dir := newTestServer(t)
		if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
			t.Fatalf("first save status = %d, want 201", rec.Code)
		}
		crossBody := `{"filename":"ai.csv","tweet":{"url":"https://x.com/renamed/status/123?s=20","author":"Other","username":"@other","tweet_date":"2026-09-27T05:00:00Z","text":"dupe"}}`
		rec := do(h, http.MethodPost, "/v1/bookmarks", crossBody)
		if rec.Code != http.StatusConflict {
			t.Fatalf("cross-file duplicate status = %d, want 409 (body %s)", rec.Code, rec.Body.String())
		}
		if _, err := os.Stat(filepath.Join(dir, "ai.csv")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("ai.csv must not be created for a cross-file duplicate (stat err = %v)", err)
		}
		if rows := csvDataRows(t, dir, "linux.csv"); len(rows) != 1 {
			t.Fatalf("linux.csv data rows = %d, want 1", len(rows))
		}
	})

	t.Run("item14_and_15_via_index_rebuild", func(t *testing.T) {
		// Authoritative coverage lives in index/rebuild_test.go; this subtest
		// keeps the §65 mapping explicit in the acceptance file.
		ix, err := index.LoadOrRebuild(t.TempDir(), logging.Discard())
		if err != nil {
			t.Fatalf("LoadOrRebuild(empty dir) error = %v", err)
		}
		if ix.Count() != 0 || ix.All() == nil {
			t.Fatalf("empty dir index = %+v, want empty non-nil", ix.All())
		}
	})

	t.Run("item17_filename_traversal_rejected", func(t *testing.T) {
		cases := []string{
			"../evil.csv",
			"../../etc/evil.csv",
			"/etc/passwd",
			"sub/evil.csv",
			`..\evil.csv`,
			"~/.ssh/evil.csv",
			"linux.csv\x00",
			"..",
			".",
			"linux.txt",
			"Linux.csv",
		}
		h, dir := newTestServer(t)
		for _, name := range cases {
			t.Run(fmt.Sprintf("%q", name), func(t *testing.T) {
				req := model.SaveRequest{
					Filename: name,
					Tweet: model.TweetInput{
						URL:       "https://x.com/foo/status/123",
						Author:    "Foo",
						Username:  "@foo",
						TweetDate: "2026-09-27T01:00:00Z",
						Text:      "hi",
					},
				}
				payload, err := json.Marshal(req)
				if err != nil {
					t.Fatalf("marshal request: %v", err)
				}
				rec := do(h, http.MethodPost, "/v1/bookmarks", string(payload))
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("filename %q status = %d, want 400 (body %s)", name, rec.Code, rec.Body.String())
				}
				if body := decode[model.ErrorResponse](t, rec); body.Status != "error" {
					t.Fatalf("error body = %+v, want status=error", body)
				}
			})
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("ReadDir: %v", err)
		}
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".csv") {
				t.Errorf("rejected traversal request created %s", e.Name())
			}
		}
	})

	t.Run("item19_index_persist_failure_still_201", func(t *testing.T) {
		dir := t.TempDir()
		idx := index.New()
		// Make index.Persist fail deterministically: its rename target is a
		// non-empty directory.
		if err := os.Mkdir(filepath.Join(dir, "index.json"), 0o700); err != nil {
			t.Fatalf("mkdir index.json: %v", err)
		}
		store := storage.NewStore(dir, idx, logging.Discard())
		h := api.NewServer(store, idx, logging.Discard())

		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 despite index persistence failure (body %s)", rec.Code, rec.Body.String())
		}
		if resp := decode[model.SaveResponse](t, rec); resp.Status != "saved" {
			t.Fatalf("response = %+v, want status=saved", resp)
		}
		if rows := csvDataRows(t, dir, "linux.csv"); len(rows) != 1 {
			t.Fatalf("linux.csv data rows = %d, want 1", len(rows))
		}
		if idx.Count() != 1 {
			t.Fatalf("in-memory index count = %d, want 1", idx.Count())
		}
	})

	t.Run("item20_no_categories_or_settings_surface", func(t *testing.T) {
		h, _ := newTestServer(t)

		// There must be no categories/settings endpoint of any method.
		paths := []string{
			"/v1/categories",
			"/v1/categories/linux",
			"/v1/settings",
			"/v1/config",
			"/categories",
			"/settings",
		}
		methods := []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete}
		for _, p := range paths {
			for _, m := range methods {
				rec := do(h, m, p, "")
				if rec.Code != http.StatusNotFound {
					t.Errorf("%s %s status = %d, want 404 (no such endpoint)", m, p, rec.Code)
				}
			}
		}

		// Settings/category fields are not part of the save payload and are
		// rejected, so the backend persists no settings or category state.
		withUnknown := []string{
			`{"filename":"linux.csv","settings":{"unbookmarkAfterSave":true},"tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`,
			`{"filename":"linux.csv","categories":[{"name":"Linux"}],"tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`,
			`{"filename":"linux.csv","category":{"name":"Linux"},"tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`,
		}
		for _, body := range withUnknown {
			if rec := do(h, http.MethodPost, "/v1/bookmarks", body); rec.Code != http.StatusBadRequest {
				t.Errorf("save with unknown settings/category field status = %d, want 400", rec.Code)
			}
		}

		// The success contract carries bookmark data only.
		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		if rec.Code != http.StatusCreated {
			t.Fatalf("save status = %d, want 201", rec.Code)
		}
		var keys map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, forbidden := range []string{"settings", "category", "categories", "color", "order"} {
			if _, ok := keys[forbidden]; ok {
				t.Errorf("save response leaked %q: %v", forbidden, keys)
			}
		}
	})
}

// TestPRD65ValidationAndErrorMapping pins every 400 validation class and the
// 500 mapping that §65 references via PRD §21 (invalid payload → 400,
// filesystem/internal → 500).
func TestPRD65ValidationAndErrorMapping(t *testing.T) {
	t.Run("400_validation_cases", func(t *testing.T) {
		cases := []struct {
			item string
			body string
		}{
			{"invalid_filename", `{"filename":"../x.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
			{"invalid_x_url_host", `{"filename":"linux.csv","tweet":{"url":"https://example.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
			{"invalid_x_url_scheme", `{"filename":"linux.csv","tweet":{"url":"ftp://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
			{"missing_author", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
			{"missing_username", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"","tweet_date":"2026-09-27T01:00:00Z"}}`},
			{"invalid_tweet_date", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"27-09-2026"}}`},
			{"invalid_payload_malformed_json", `{`},
			{"invalid_payload_wrong_type", `[]`},
			{"invalid_payload_empty_body", ``},
		}
		for _, tc := range cases {
			t.Run(tc.item, func(t *testing.T) {
				h, dir := newTestServer(t)
				rec := do(h, http.MethodPost, "/v1/bookmarks", tc.body)
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
				}
				if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
				if body := decode[model.ErrorResponse](t, rec); body.Status != "error" {
					t.Errorf("error body = %+v, want status=error", body)
				}
				entries, err := os.ReadDir(dir)
				if err != nil {
					t.Fatalf("ReadDir: %v", err)
				}
				for _, e := range entries {
					if strings.HasSuffix(e.Name(), ".csv") {
						t.Errorf("rejected request created %s", e.Name())
					}
				}
			})
		}
	})

	t.Run("500_internal_error_mapping", func(t *testing.T) {
		h := api.NewServer(stubStore{err: errors.New("disk on fire")}, stubIndex{}, logging.Discard())
		rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		body := decode[model.ErrorResponse](t, rec)
		if body.Status != "error" || body.Reason != "internal error" {
			t.Fatalf("body = %+v, want status=error reason=internal error", body)
		}
	})
}
