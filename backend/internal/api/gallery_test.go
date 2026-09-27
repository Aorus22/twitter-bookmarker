// Acceptance tests for the read-only gallery HTTP API (PRD-2 §36-§41, §54, §70,
// §80.4-§80.23).
//
// The suite seeds its own storage directory inside t.TempDir() and points the
// server at it through TWITTER_BOOKMARKER_DIR, so it never depends on an
// external fixture. Every response body is also asserted against the raw bytes,
// not just the decoded fields, because "media is [] not null" and "the storage
// path is never leaked" are wire-level contracts.
package api_test

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
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

// galleryCollectionDTO mirrors the PRD-2 §37 collection object. Using an
// explicit local struct (rather than the api package's unexported DTO) pins the
// exact JSON field names and types across the package boundary.
type galleryCollectionDTO struct {
	Filename    string   `json:"filename"`
	Name        string   `json:"name"`
	PostCount   int      `json:"post_count"`
	MediaCount  int      `json:"media_count"`
	LastSavedAt *string  `json:"last_saved_at"`
	CoverMedia  []string `json:"cover_media"`
}

type galleryCollectionsDTO struct {
	Collections []galleryCollectionDTO `json:"collections"`
}

// galleryPostDTO mirrors the PRD-2 §41 post object.
type galleryPostDTO struct {
	TweetID   string   `json:"tweet_id"`
	URL       string   `json:"url"`
	Media     []string `json:"media"`
	Author    string   `json:"author"`
	Username  string   `json:"username"`
	TweetDate string   `json:"tweet_date"`
	SavedAt   string   `json:"saved_at"`
	Text      string   `json:"text"`
}

type galleryPostsDTO struct {
	Items      []galleryPostDTO `json:"items"`
	NextCursor *string          `json:"next_cursor"`
	HasMore    bool             `json:"has_more"`
}

const (
	galleryCollectionsPath = "/api/gallery/collections"
	galleryPostsPath       = "/api/gallery/collections/linux.csv/posts"
)

// newGalleryServer builds the full API over a fresh temp storage dir and points
// the per-request gallery reader at it through TWITTER_BOOKMARKER_DIR.
func newGalleryServer(t *testing.T, log *logging.Logger) (http.Handler, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("TWITTER_BOOKMARKER_DIR", dir)
	if log == nil {
		log = logging.Discard()
	}
	idx, err := index.LoadOrRebuild(dir, log)
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	store := storage.NewStore(dir, idx, log)
	return api.NewServer(store, idx, log), dir
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// writeGalleryCSV writes a header plus rows with encoding/csv, so a JSON `media`
// cell keeps its inner quotes correctly doubled rather than corrupting the row.
func writeGalleryCSV(t *testing.T, dir, name string, rows [][]string) {
	t.Helper()
	file, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	defer file.Close()

	w := csv.NewWriter(file)
	if err := w.Write(strings.Split(storage.Header, ",")); err != nil {
		t.Fatalf("write header for %s: %v", name, err)
	}
	for _, row := range rows {
		if err := w.Write(row); err != nil {
			t.Fatalf("write row for %s: %v", name, err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		t.Fatalf("flush %s: %v", name, err)
	}
}

func mediaURLs(names ...string) string {
	if len(names) == 0 {
		return "[]"
	}
	urls := make([]string, 0, len(names))
	for _, name := range names {
		urls = append(urls, "https://pbs.twimg.com/media/"+name+".jpg")
	}
	encoded, err := json.Marshal(urls)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// linuxRows builds 8 valid rows. tweet_date and saved_at both run newest (row
// 1) to oldest (row 8) so every sort mode has an unambiguous first row:
//
//	saved_desc / tweet_desc -> ...001
//	saved_asc  / tweet_asc  -> ...008
//
// Media counts are 4,3,2,1,0,0,2,1 (13 total) and "wayland"/"@linuxguy" appear
// in a known number of rows for the search assertions.
func linuxRows() [][]string {
	rows := make([][]string, 0, 8)
	for i := 1; i <= 8; i++ {
		tweet := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(i - 1))
		saved := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(i - 1))

		var media string
		switch i {
		case 1:
			media = mediaURLs("m1", "m1b", "m1c", "m1d")
		case 2:
			media = mediaURLs("m2", "m2b", "m2c")
		case 3:
			media = mediaURLs("m3", "m3b")
		case 4, 8:
			media = mediaURLs("m" + fmt.Sprint(i))
		case 7:
			media = mediaURLs("m7", "m7b")
		default:
			media = mediaURLs()
		}

		author, username := "Linux Guy", "@linuxguy"
		switch i {
		case 3:
			author, username = "Tiling Fan", "@tilingfan"
		case 4:
			author, username = "Kernel Notes", "@kernelnotes"
		case 6:
			author, username = "Shell Pilled", "@shellpilled"
		case 8:
			author, username = "Tiling Fan", "@tilingfan"
		}

		text := fmt.Sprintf("post %d", i)
		switch i {
		case 1:
			text = "Wayland compositor notes"
		case 7:
			text = "wayland benchmarks, again"
		}

		rows = append(rows, []string{
			fmt.Sprintf("https://x.com/user/status/100000000000000000%d", i),
			media, author, username,
			tweet.Format(time.RFC3339), saved.Format(time.RFC3339), text,
		})
	}
	return rows
}

func seedLinux(t *testing.T, dir string) {
	t.Helper()
	writeGalleryCSV(t, dir, "linux.csv", linuxRows())
}

// seedAllCollections adds a one-post second collection, an empty third one and
// the decoys that must never appear as collections.
func seedAllCollections(t *testing.T, dir string) {
	t.Helper()
	seedLinux(t, dir)
	writeGalleryCSV(t, dir, "ai-and-llm.csv", [][]string{{
		"https://x.com/aiperson/status/2000000000000000001",
		mediaURLs("d1"),
		"AI Person", "@aiperson",
		"2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z",
		"Older than every linux row",
	}})
	writeGalleryCSV(t, dir, "design.csv", nil)
	writeFile(t, filepath.Join(dir, "index.json"), `{"version":1,"tweets":{}}`)
	writeFile(t, filepath.Join(dir, "notes.txt"), "not a csv\n")
	writeFile(t, filepath.Join(dir, ".hidden.csv"), storage.Header+"\n")
	writeFile(t, filepath.Join(dir, "linux.csv.bak"), storage.Header+"\n")
}

func fetchCollections(t *testing.T, h http.Handler) galleryCollectionsDTO {
	t.Helper()
	rec := do(h, http.MethodGet, galleryCollectionsPath, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("collections status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("collections Content-Type = %q, want application/json", ct)
	}
	var body galleryCollectionsDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode collections %q: %v", rec.Body.String(), err)
	}
	return body
}

func fetchPosts(t *testing.T, h http.Handler, query string) (*galleryPostsDTO, string) {
	t.Helper()
	path := galleryPostsPath
	if query != "" {
		path += "?" + query
	}
	rec := do(h, http.MethodGet, path, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("posts %q status = %d, want 200 (body %s)", query, rec.Code, rec.Body.String())
	}
	var body galleryPostsDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode posts %q: %v", query, err)
	}
	return &body, rec.Body.String()
}

func postIDs(page *galleryPostsDTO) []string {
	ids := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		ids = append(ids, item.TweetID)
	}
	return ids
}

// ---------------------------------------------------------------------------
// API-01 / API-02 — GET /api/gallery/collections
// ---------------------------------------------------------------------------

func TestGalleryCollectionsEndpoint(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedAllCollections(t, dir)

	rec := do(h, http.MethodGet, galleryCollectionsPath, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	raw := rec.Body.String()
	if strings.Contains(raw, dir) {
		t.Fatalf("collections body leaked the storage dir %q: %s", dir, raw)
	}
	if strings.Contains(raw, `"cover_media":null`) {
		t.Errorf("cover_media must never serialise as null: %s", raw)
	}

	body := fetchCollections(t, h)
	if len(body.Collections) != 3 {
		t.Fatalf("collections = %d, want exactly 3 (got %+v)", len(body.Collections), body.Collections)
	}

	wantNames := []string{"Linux", "AI And LLM", "Design"}
	for i, want := range wantNames {
		if got := body.Collections[i].Name; got != want {
			t.Errorf("collections[%d].name = %q, want %q (ordering is last_saved_at DESC, timestamp-less last)", i, got, want)
		}
	}

	linux := body.Collections[0]
	if linux.Filename != "linux.csv" {
		t.Errorf("collections[0].filename = %q, want linux.csv", linux.Filename)
	}
	if linux.PostCount != 8 {
		t.Errorf("linux post_count = %d, want 8", linux.PostCount)
	}
	if linux.MediaCount != 13 {
		t.Errorf("linux media_count = %d, want 13", linux.MediaCount)
	}
	if linux.LastSavedAt == nil {
		t.Fatalf("linux last_saved_at = null, want a timestamp")
	}
	if _, err := time.Parse(time.RFC3339, *linux.LastSavedAt); err != nil {
		t.Errorf("linux last_saved_at %q is not RFC3339: %v", *linux.LastSavedAt, err)
	}
	if len(linux.CoverMedia) != 4 {
		t.Errorf("linux cover_media = %v, want exactly 4 URLs", linux.CoverMedia)
	} else if !strings.HasSuffix(linux.CoverMedia[0], "m1.jpg") {
		t.Errorf("linux cover_media[0] = %q, want the newest row's first media (m1.jpg)", linux.CoverMedia[0])
	}

	design := body.Collections[2]
	if design.PostCount != 0 || design.MediaCount != 0 {
		t.Errorf("design = %+v, want an empty collection", design)
	}
	if design.LastSavedAt != nil {
		t.Errorf("design last_saved_at = %q, want null for an empty CSV", *design.LastSavedAt)
	}
	if design.CoverMedia == nil || len(design.CoverMedia) != 0 {
		t.Errorf("design cover_media = %v, want an empty array", design.CoverMedia)
	}
	if !strings.Contains(raw, `"last_saved_at":null`) {
		t.Errorf("empty collection must serialise last_saved_at as null: %s", raw)
	}

	for _, decoy := range []string{"index.json", "notes.txt", ".hidden.csv", "linux.csv.bak"} {
		if strings.Contains(raw, decoy) {
			t.Errorf("decoy %q leaked into the collections response: %s", decoy, raw)
		}
	}

	// The collection object carries exactly the six documented fields.
	var shape struct {
		Collections []map[string]json.RawMessage `json:"collections"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &shape); err != nil {
		t.Fatalf("decode raw collections: %v", err)
	}
	if got := len(shape.Collections[0]); got != 6 {
		t.Errorf("collection object has %d fields, want 6: %v", got, shape.Collections[0])
	}
}

func TestGalleryCollectionsEmptyStorageDir(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	rec := do(h, http.MethodGet, galleryCollectionsPath, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"collections":[]`) {
		t.Errorf("empty gallery body = %s, want collections:[]", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// API-03 / API-06 — GET .../{filename}/posts shapes, filters and sorting
// ---------------------------------------------------------------------------

func TestGalleryPostsHappyPath(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	page, raw := fetchPosts(t, h, "")
	if len(page.Items) != 8 {
		t.Fatalf("default page items = %d, want all 8 (absent limit must default to 30)", len(page.Items))
	}
	if page.HasMore {
		t.Errorf("has_more = true for an 8-post collection with default limit, want false")
	}
	if page.NextCursor != nil {
		t.Errorf("terminal next_cursor = %q, want null", *page.NextCursor)
	}
	if !strings.Contains(raw, `"next_cursor":null`) {
		t.Errorf("terminal page must serialise next_cursor as null: %s", raw)
	}
	if !strings.Contains(raw, `"has_more":false`) {
		t.Errorf("terminal page must serialise has_more:false: %s", raw)
	}
	if ids := postIDs(page); len(ids) == 0 || ids[0] != "1000000000000000001" {
		t.Errorf("first id = %v, want the newest-saved ...001 first (saved_desc default)", ids)
	}

	first := page.Items[0]
	if first.URL != "https://x.com/user/status/1000000000000000001" {
		t.Errorf("item url = %q, want the canonical tweet URL", first.URL)
	}
	if first.Author == "" || first.Username == "" || first.Text == "" {
		t.Errorf("item = %+v, want non-empty author/username/text", first)
	}
	if _, err := time.Parse(time.RFC3339, first.TweetDate); err != nil {
		t.Errorf("tweet_date %q is not RFC3339: %v", first.TweetDate, err)
	}
	if _, err := time.Parse(time.RFC3339, first.SavedAt); err != nil {
		t.Errorf("saved_at %q is not RFC3339: %v", first.SavedAt, err)
	}

	// The post object carries exactly the eight documented fields, and a
	// text-only row serialises media as [] rather than null.
	var shape struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal([]byte(raw), &shape); err != nil {
		t.Fatalf("decode raw posts: %v", err)
	}
	if got := len(shape.Items[0]); got != 8 {
		t.Errorf("post object has %d fields, want 8: %v", got, shape.Items[0])
	}
	for i, item := range shape.Items {
		if _, ok := item["media"]; !ok {
			t.Fatalf("item %d is missing media", i)
		}
		if string(item["media"]) == "null" {
			t.Errorf("item %d media serialised as null, want []", i)
		}
	}
	var textOnly map[string]json.RawMessage
	for i, item := range shape.Items {
		if page.Items[i].TweetID == "1000000000000000005" {
			textOnly = item
		}
	}
	if textOnly == nil {
		t.Fatalf("text-only post ...005 missing from the page")
	}
	if got := string(textOnly["media"]); got != "[]" {
		t.Errorf("text-only media = %s, want []", got)
	}
}

func TestGalleryPostsLimitBehaviour(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	page, _ := fetchPosts(t, h, "limit=3")
	if len(page.Items) != 3 {
		t.Fatalf("limit=3 items = %d, want 3", len(page.Items))
	}
	if !page.HasMore {
		t.Errorf("limit=3 has_more = false, want true for an 8-post collection")
	}
	if page.NextCursor == nil || *page.NextCursor == "" {
		t.Fatalf("limit=3 next_cursor = %v, want a non-null opaque cursor", page.NextCursor)
	}

	for _, query := range []string{"limit=", "limit=100", "limit=1", "limit=30"} {
		page, _ := fetchPosts(t, h, query)
		want := 8
		if query == "limit=1" {
			want = 1
		}
		if len(page.Items) != want {
			t.Errorf("%s items = %d, want %d", query, len(page.Items), want)
		}
	}
}

func TestGalleryPostsValidation(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	badCursorNoPipe := base64.RawURLEncoding.EncodeToString([]byte("just-a-payload"))
	badCursorTimestamp := base64.RawURLEncoding.EncodeToString([]byte("not-a-time|123"))

	cases := []struct {
		name   string
		query  string
		status int
	}{
		{"absent_limit_defaults", "", http.StatusOK},
		{"explicit_limit_ok", "limit=100", http.StatusOK},
		{"empty_limit_defaults", "limit=", http.StatusOK},
		{"limit_zero", "limit=0", http.StatusBadRequest},
		{"limit_negative", "limit=-1", http.StatusBadRequest},
		{"limit_too_large", "limit=101", http.StatusBadRequest},
		{"limit_not_numeric", "limit=abc", http.StatusBadRequest},
		{"limit_float", "limit=1.5", http.StatusBadRequest},
		{"sort_unknown", "sort=bogus", http.StatusBadRequest},
		{"sort_wrong_case", "sort=SAVED_DESC", http.StatusBadRequest},
		{"tweet_from_not_a_date", "tweet_from=not-a-date", http.StatusBadRequest},
		{"tweet_to_not_a_date", "tweet_to=not-a-date", http.StatusBadRequest},
		{"saved_from_not_a_date", "saved_from=not-a-date", http.StatusBadRequest},
		{"saved_to_not_a_date", "saved_to=not-a-date", http.StatusBadRequest},
		{"cursor_not_base64", "cursor=%21%21%21", http.StatusBadRequest},
		{"cursor_no_separator", "cursor=" + badCursorNoPipe, http.StatusBadRequest},
		{"cursor_bad_timestamp", "cursor=" + badCursorTimestamp, http.StatusBadRequest},
		{"sort_saved_asc_ok", "sort=saved_asc", http.StatusOK},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := galleryPostsPath
			if tc.query != "" {
				path += "?" + tc.query
			}
			rec := do(h, http.MethodGet, path, "")
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.status, rec.Body.String())
			}
			if tc.status != http.StatusBadRequest {
				return
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			var body model.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
			}
			if body.Status != "error" || body.Reason == "" {
				t.Errorf("error body = %+v, want status=error with a reason", body)
			}
			if strings.Contains(rec.Body.String(), dir) {
				t.Errorf("400 body leaked the storage dir: %s", rec.Body.String())
			}
		})
	}
}

func TestGalleryPostsSearchAndDateFilters(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	cases := []struct {
		name      string
		query     string
		wantCount int
	}{
		{"search_text_case_insensitive", "q=wayland", 2},
		{"search_upper_case", "q=WAYLAND", 2},
		{"search_username", "q=linuxguy", 4},
		{"search_author", "q=Shell%20Pilled", 1},
		{"search_miss", "q=nomatch", 0},
		{"tweet_from_inclusive", "tweet_from=2026-08-31T00:00:00Z", 2},
		{"tweet_to_inclusive", "tweet_to=2026-08-31T00:00:00Z", 7},
		{"saved_from_inclusive", "saved_from=2026-09-29T00:00:00Z", 2},
		{"saved_to_inclusive", "saved_to=2026-09-29T00:00:00Z", 7},
		{"filters_combine_as_and", "saved_from=2026-09-29T00:00:00Z&tweet_to=2026-08-31T00:00:00Z", 1},
		{"search_plus_filter", "q=wayland&saved_from=2026-09-25T00:00:00Z", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			page, _ := fetchPosts(t, h, tc.query)
			if len(page.Items) != tc.wantCount {
				t.Fatalf("%s items = %d, want %d (ids %v)", tc.query, len(page.Items), tc.wantCount, postIDs(page))
			}
		})
	}

	for _, tc := range []struct {
		name  string
		query string
		first string
	}{
		{"default_saved_desc", "", "1000000000000000001"},
		{"saved_desc", "sort=saved_desc", "1000000000000000001"},
		{"saved_asc", "sort=saved_asc", "1000000000000000008"},
		{"tweet_desc", "sort=tweet_desc", "1000000000000000001"},
		{"tweet_asc", "sort=tweet_asc", "1000000000000000008"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			page, _ := fetchPosts(t, h, tc.query)
			if len(page.Items) == 0 {
				t.Fatalf("%s returned no items", tc.query)
			}
			if got := page.Items[0].TweetID; got != tc.first {
				t.Errorf("%s first id = %s, want %s", tc.query, got, tc.first)
			}
		})
	}
}

func TestGalleryCursorWalk(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	seen := map[string]int{}
	cursor := ""
	pages := 0
	for {
		query := "limit=3"
		if cursor != "" {
			query += "&cursor=" + cursor
		}
		page, _ := fetchPosts(t, h, query)
		for _, id := range postIDs(page) {
			seen[id]++
		}
		pages++

		if !page.HasMore {
			if page.NextCursor != nil {
				t.Fatalf("terminal page next_cursor = %q, want null", *page.NextCursor)
			}
			break
		}
		if page.NextCursor == nil || *page.NextCursor == "" {
			t.Fatalf("has_more=true but next_cursor = %v", page.NextCursor)
		}
		cursor = *page.NextCursor
		if pages > 10 {
			t.Fatalf("cursor walk did not terminate after %d pages", pages)
		}
	}

	if pages != 3 {
		t.Errorf("pages = %d, want 3 for 8 posts at limit=3", pages)
	}
	if len(seen) != 8 {
		t.Errorf("distinct ids = %d, want 8 (%v)", len(seen), seen)
	}
	for id, count := range seen {
		if count != 1 {
			t.Errorf("id %s appeared %d times, want exactly once", id, count)
		}
	}
}

// ---------------------------------------------------------------------------
// API-05 — 404 and 405
// ---------------------------------------------------------------------------

func TestGalleryPostsUnknownCollectionIs404(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	for _, name := range []string{"nope.csv", "missing.csv"} {
		rec := do(h, http.MethodGet, "/api/gallery/collections/"+name+"/posts", "")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404 (body %s)", name, rec.Code, rec.Body.String())
		}
		var body model.ErrorResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode 404 body %q: %v", rec.Body.String(), err)
		}
		if body.Status != "error" || body.Reason == "" {
			t.Errorf("404 body = %+v, want the error envelope", body)
		}
		if strings.Contains(rec.Body.String(), dir) {
			t.Errorf("404 body leaked the storage dir: %s", rec.Body.String())
		}
	}
}

func TestGalleryRejectsWrites(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	before, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read seeded csv: %v", err)
	}

	for _, path := range []string{galleryCollectionsPath, galleryPostsPath} {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			rec := do(h, method, path, `{"filename":"evil.csv"}`)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s status = %d, want 405", method, path, rec.Code)
			}
		}
	}

	after, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read csv after write attempts: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("a non-GET gallery request mutated linux.csv")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "linux.csv" {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("gallery write attempts created files: %v", names)
	}
}

// ---------------------------------------------------------------------------
// API-07 — traversal, path leakage, internal errors
// ---------------------------------------------------------------------------

func TestGalleryRejectsTraversalAndBadFilenames(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedAllCollections(t, dir)

	cases := []struct {
		name string
		path string
		// want is the set of acceptable status codes. The raw `../` form is
		// cleaned and redirected by Go's ServeMux before any handler runs (a
		// 307 to the equivalent cleaned path, which then 404s), so the test
		// accepts that as "never read a file" alongside the handler's 400.
		want []int
	}{
		{"encoded_dotdot", "/api/gallery/collections/..%2Fsecret.csv/posts", []int{http.StatusBadRequest}},
		{"encoded_dotdot_hex", "/api/gallery/collections/%2e%2e%2fsecret.csv/posts", []int{http.StatusBadRequest}},
		{"encoded_slash", "/api/gallery/collections/a%2Fb.csv/posts", []int{http.StatusBadRequest}},
		{"non_csv_extension", "/api/gallery/collections/x.txt/posts", []int{http.StatusBadRequest}},
		{"uppercase_filename", "/api/gallery/collections/Linux.csv/posts", []int{http.StatusBadRequest}},
		{"existing_non_csv", "/api/gallery/collections/notes.txt/posts", []int{http.StatusBadRequest}},
		{"backslash", "/api/gallery/collections/..%5Csecret.csv/posts", []int{http.StatusBadRequest}},
		{"raw_dotdot", "/api/gallery/collections/../secret.csv/posts", []int{http.StatusTemporaryRedirect, http.StatusBadRequest, http.StatusNotFound}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(h, http.MethodGet, tc.path, "")
			allowed := false
			for _, want := range tc.want {
				if rec.Code == want {
					allowed = true
				}
			}
			if !allowed {
				t.Fatalf("status = %d, want one of %v (body %s)", rec.Code, tc.want, rec.Body.String())
			}
			if rec.Code == http.StatusOK {
				t.Fatalf("traversal path was served: %s", rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), dir) {
				t.Errorf("rejection body leaked the storage dir: %s", rec.Body.String())
			}
		})
	}

	// A raw `../` must not read anything even when the redirect is followed.
	rec := do(h, http.MethodGet, "/api/gallery/collections/../secret.csv/posts", "")
	if loc := rec.Header().Get("Location"); loc != "" {
		next := do(h, http.MethodGet, loc, "")
		if next.Code != http.StatusNotFound {
			t.Errorf("redirect target %q status = %d, want 404", loc, next.Code)
		}
	}
}

func TestGalleryInternalErrorIsSanitisedAndLogged(t *testing.T) {
	base := t.TempDir()
	storagePath := filepath.Join(base, "storage-is-a-file")
	writeFile(t, storagePath, "not a directory\n")
	t.Setenv("TWITTER_BOOKMARKER_DIR", storagePath)

	var logs bytes.Buffer
	h := api.NewServer(nil, nil, logging.New(&logs))

	for _, path := range []string{
		galleryCollectionsPath,
		galleryPostsPath,
	} {
		t.Run(path, func(t *testing.T) {
			rec := do(h, http.MethodGet, path, "")
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
			}
			var body model.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode 500 body %q: %v", rec.Body.String(), err)
			}
			if body.Status != "error" || body.Reason != "internal error" {
				t.Errorf("500 body = %+v, want the generic error envelope", body)
			}
			raw := rec.Body.String()
			if strings.Contains(raw, base) || strings.Contains(raw, storagePath) || strings.Contains(raw, "storage-is-a-file") {
				t.Errorf("500 body leaked the storage path: %s", raw)
			}
		})
	}

	// The real error must still reach the server-side log.
	if !strings.Contains(logs.String(), "storage-is-a-file") {
		t.Errorf("expected the real error in the server log; got %q", logs.String())
	}
}

// ---------------------------------------------------------------------------
// v1.0 contract regression
// ---------------------------------------------------------------------------

func TestGalleryRoutesDoNotDisturbV1Contracts(t *testing.T) {
	h, dir := newGalleryServer(t, nil)
	seedLinux(t, dir)

	if rec := do(h, http.MethodGet, "/health", ""); rec.Code != http.StatusOK {
		t.Errorf("/health status = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodGet, "/v1/index", ""); rec.Code != http.StatusOK {
		t.Errorf("/v1/index status = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodPost, "/v1/bookmarks", validBody); rec.Code != http.StatusCreated {
		t.Errorf("POST /v1/bookmarks status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}
}
