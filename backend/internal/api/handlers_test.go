package api_test

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

const validBody = `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123?s=20","author":"Foo Bar","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"Testing Linux today"}}`

func newTestServer(t *testing.T) (http.Handler, string) {
	t.Helper()
	dir := t.TempDir()
	idx, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	store := storage.NewStore(dir, idx, logging.Discard())
	return api.NewServer(store, idx, logging.Discard()), dir
}

func do(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestHealth(t *testing.T) {
	h, _ := newTestServer(t)
	rec := do(h, http.MethodGet, "/health", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	if got := decode[model.HealthResponse](t, rec).Status; got != "ok" {
		t.Fatalf("status field = %q, want ok", got)
	}
}

func TestIndexEmptyShape(t *testing.T) {
	h, _ := newTestServer(t)
	rec := do(h, http.MethodGet, "/v1/index", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"items":{}`) {
		t.Fatalf("body = %s, want items to be an empty object", rec.Body.String())
	}
}

func TestIndexAfterSave(t *testing.T) {
	h, _ := newTestServer(t)

	if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
		t.Fatalf("save status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}

	rec := do(h, http.MethodGet, "/v1/index", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("index status = %d, want 200", rec.Code)
	}
	var body model.IndexResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode index: %v", err)
	}
	entry, ok := body.Items["123"]
	if !ok {
		t.Fatalf("items missing tweet 123: %+v", body.Items)
	}
	if entry.URL != "https://x.com/foo/status/123" {
		t.Errorf("entry.URL = %q, want canonical URL", entry.URL)
	}
	if entry.Filename != "linux.csv" {
		t.Errorf("entry.Filename = %q, want linux.csv", entry.Filename)
	}
	if _, err := time.Parse(time.RFC3339, entry.SavedAt); err != nil {
		t.Errorf("entry.SavedAt = %q, want RFC3339: %v", entry.SavedAt, err)
	}
}

func TestSaveCreatedContract(t *testing.T) {
	h, dir := newTestServer(t)
	rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}

	var keys map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
		t.Fatalf("decode: %v", err)
	}
	wantKeys := []string{"status", "tweet_id", "url", "filename", "saved_at"}
	if len(keys) != len(wantKeys) {
		t.Fatalf("response keys = %v, want exactly %v", keys, wantKeys)
	}
	for _, k := range wantKeys {
		if _, ok := keys[k]; !ok {
			t.Errorf("response missing key %q", k)
		}
	}

	resp := decode[model.SaveResponse](t, rec)
	if resp.Status != "saved" {
		t.Errorf("status = %q, want saved", resp.Status)
	}
	if resp.TweetID != "123" {
		t.Errorf("tweet_id = %q, want 123", resp.TweetID)
	}
	if resp.URL != "https://x.com/foo/status/123" {
		t.Errorf("url = %q, want canonical", resp.URL)
	}
	if resp.Filename != "linux.csv" {
		t.Errorf("filename = %q, want linux.csv", resp.Filename)
	}
	if _, err := time.Parse(time.RFC3339, resp.SavedAt); err != nil {
		t.Errorf("saved_at = %q, want RFC3339: %v", resp.SavedAt, err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read linux.csv: %v", err)
	}
	first := strings.SplitN(strings.TrimRight(string(raw), "\n"), "\n", 2)[0]
	if first != storage.Header {
		t.Fatalf("csv header = %q, want %q", first, storage.Header)
	}
}

func TestSaveDuplicateReturns409(t *testing.T) {
	h, dir := newTestServer(t)

	if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
		t.Fatalf("first save status = %d, want 201", rec.Code)
	}

	dupBody := `{"filename":"ai.csv","tweet":{"url":"https://x.com/other/status/123","author":"Foo Bar","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"dupe"}}`
	rec := do(h, http.MethodPost, "/v1/bookmarks", dupBody)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d, want 409 (body %s)", rec.Code, rec.Body.String())
	}

	var keys map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("duplicate response keys = %v, want exactly status+tweet_id", keys)
	}
	dup := decode[model.DuplicateResponse](t, rec)
	if dup.Status != "duplicate" || dup.TweetID != "123" {
		t.Fatalf("duplicate response = %+v, want status=duplicate tweet_id=123", dup)
	}

	if _, err := os.Stat(filepath.Join(dir, "ai.csv")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("ai.csv must not be created for a duplicate (stat err = %v)", err)
	}
	if rows := csvDataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Errorf("linux.csv data rows = %d, want 1", len(rows))
	}
}

func TestSaveInvalidRequestsReturn400(t *testing.T) {
	validTweet := `"tweet":{"url":"https://x.com/foo/status/123","author":"Foo Bar","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"hi"}`

	tests := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"malformed json", `{`},
		{"json array", `[]`},
		{"unknown top-level field (settings)", `{"filename":"linux.csv","settings":{},"tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"unknown top-level field (category)", `{"filename":"linux.csv","category":"Linux","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"unknown nested field", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z","quoted_text":"nope"}}`},
		{"wrong field type", `{"filename":123,"tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"empty filename", `{"filename":"","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"traversal filename", `{"filename":"../x.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"absolute filename", `{"filename":"/etc/passwd","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"unslugged filename", `{"filename":"Linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"bad url host", `{"filename":"linux.csv","tweet":{"url":"https://example.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"no status id", `{"filename":"linux.csv","tweet":{"url":"https://x.com/i/bookmarks","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"missing author", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"","username":"@a","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"missing username", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"","tweet_date":"2026-09-27T01:00:00Z"}}`},
		{"missing tweet_date", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":""}}`},
		{"bad tweet_date", `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"27-09-2026"}}`},
		{"missing tweet object", `{"filename":"linux.csv"}`},
		{"valid tweet, missing filename", `{` + validTweet + `}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h, dir := newTestServer(t)
			rec := do(h, http.MethodPost, "/v1/bookmarks", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			var body model.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
			}
			if body.Status != "error" {
				t.Errorf("error body status = %q, want error", body.Status)
			}
			// A rejected request must never leave a CSV behind.
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
}

func TestSaveOversizedBodyReturns400(t *testing.T) {
	h, _ := newTestServer(t)

	body := `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123","author":"A","username":"@a","tweet_date":"2026-09-27T01:00:00Z","text":"` +
		strings.Repeat("x", 2<<20) + `"}}`
	rec := do(h, http.MethodPost, "/v1/bookmarks", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for oversized body", rec.Code)
	}
}

func TestMethodNotAllowedAndNotFound(t *testing.T) {
	h, _ := newTestServer(t)

	tests := []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodDelete, "/health", http.StatusMethodNotAllowed},
		{http.MethodPost, "/health", http.StatusMethodNotAllowed},
		{http.MethodGet, "/v1/bookmarks", http.StatusMethodNotAllowed},
		{http.MethodGet, "/nope", http.StatusNotFound},
		{http.MethodGet, "/v2/index", http.StatusNotFound},
	}
	for _, tc := range tests {
		rec := do(h, tc.method, tc.path, "")
		if rec.Code != tc.want {
			t.Errorf("%s %s status = %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
	}
}

func TestInternalErrorReturns500(t *testing.T) {
	h := api.NewServer(stubStore{err: errors.New("disk on fire")}, stubIndex{}, logging.Discard())
	rec := do(h, http.MethodPost, "/v1/bookmarks", validBody)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := decode[model.ErrorResponse](t, rec)
	if body.Status != "error" || body.Reason != "internal error" {
		t.Fatalf("body = %+v, want status=error reason=internal error", body)
	}
}

func TestCORSOnlyForExtensionOrigins(t *testing.T) {
	h, _ := newTestServer(t)

	// Extension origin gets an echoed, non-wildcard grant plus a preflight.
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "chrome-extension://abcdefghijklmnop")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "chrome-extension://abcdefghijklmnop" {
		t.Errorf("ACAO = %q, want echoed extension origin", got)
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/v1/bookmarks", nil)
	preflight.Header.Set("Origin", "chrome-extension://abcdefghijklmnop")
	preflightRec := httptest.NewRecorder()
	h.ServeHTTP(preflightRec, preflight)
	if preflightRec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", preflightRec.Code)
	}
	if got := preflightRec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Errorf("preflight allow-methods = %q, want POST", got)
	}

	// Arbitrary web origin is never granted access.
	evil := httptest.NewRequest(http.MethodGet, "/health", nil)
	evil.Header.Set("Origin", "https://evil.example")
	evilRec := httptest.NewRecorder()
	h.ServeHTTP(evilRec, evil)
	if got := evilRec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("ACAO for arbitrary origin = %q, want empty", got)
	}
	if evilRec.Code != http.StatusOK {
		t.Errorf("health status = %d, want 200", evilRec.Code)
	}

	evilPreflight := httptest.NewRequest(http.MethodOptions, "/v1/bookmarks", nil)
	evilPreflight.Header.Set("Origin", "https://evil.example")
	evilPreflightRec := httptest.NewRecorder()
	h.ServeHTTP(evilPreflightRec, evilPreflight)
	if evilPreflightRec.Code == http.StatusNoContent {
		t.Errorf("arbitrary origin preflight must not succeed")
	}
	if got := evilPreflightRec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("ACAO for arbitrary origin preflight = %q, want empty", got)
	}
}

func TestServerHandlesNilDependenciesSafely(t *testing.T) {
	h := api.NewServer(nil, nil, nil)
	if rec := do(h, http.MethodGet, "/health", ""); rec.Code != http.StatusOK {
		t.Errorf("health status = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodGet, "/v1/index", ""); rec.Code != http.StatusOK {
		t.Errorf("index status = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusInternalServerError {
		t.Errorf("save status = %d, want 500 when store is absent", rec.Code)
	}
}

// --- stubs ---

type stubStore struct{ err error }

func (s stubStore) Save(model.SaveRequest) (model.SaveResponse, error) {
	return model.SaveResponse{}, s.err
}

type stubIndex struct{ items map[string]model.IndexEntry }

func (s stubIndex) All() map[string]model.IndexEntry { return s.items }

func csvDataRows(t *testing.T, dir, name string) [][]string {
	t.Helper()
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	defer f.Close()
	recs, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if len(recs) > 0 && storage.IsHeaderRecord(recs[0]) {
		return recs[1:]
	}
	return recs
}
