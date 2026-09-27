package storage_test

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/storage"
)

// TestConcurrentSameTweetExactlyOneRow proves PRD §65 item 18 (and §24): 20
// concurrent saves of the SAME tweet yield exactly one success, 19 duplicate
// rejections and exactly one data row. Run under -race to prove the global
// write path is race-free.
func TestConcurrentSameTweetExactlyOneRow(t *testing.T) {
	store, idx, dir := newTestStore(t)

	const workers = 20
	var successes, duplicates, other atomic.Int64

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release all goroutines together to maximize contention
			_, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123?s=20", "concurrent"))
			var dup *storage.DuplicateError
			switch {
			case err == nil:
				successes.Add(1)
			case errors.As(err, &dup):
				duplicates.Add(1)
			default:
				other.Add(1)
				t.Errorf("unexpected Save() error: %v", err)
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := successes.Load(); got != 1 {
		t.Errorf("successes = %d, want 1", got)
	}
	if got := duplicates.Load(); got != int64(workers-1) {
		t.Errorf("duplicates = %d, want %d", got, workers-1)
	}
	if got := other.Load(); got != 0 {
		t.Errorf("other errors = %d, want 0", got)
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Fatalf("linux.csv data rows = %d, want exactly 1", len(rows))
	}
	if idx.Count() != 1 {
		t.Fatalf("index count = %d, want 1", idx.Count())
	}

	// Header must still appear exactly once (no interleaved partial writes).
	raw, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read linux.csv: %v", err)
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("csv lines = %d, want 2 (header + 1 row):\n%s", len(lines), raw)
	}
	if lines[0] != storage.Header {
		t.Fatalf("line 1 = %q, want header %q", lines[0], storage.Header)
	}
}

// TestConcurrentDistinctTweetsExactlyTenRows proves the write path serializes
// correctly under contention from independent saves: 10 concurrent distinct
// tweets produce exactly 10 rows and a consistent index.
func TestConcurrentDistinctTweetsExactlyTenRows(t *testing.T) {
	store, idx, dir := newTestStore(t)

	const n = 10
	var successes, other atomic.Int64

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			req := saveReq("linux.csv", fmt.Sprintf("https://x.com/foo/status/%d", 1000+i), fmt.Sprintf("tweet %d", i))
			if _, err := store.Save(req); err != nil {
				other.Add(1)
				t.Errorf("Save(%d) error = %v", i, err)
				return
			}
			successes.Add(1)
		}(i)
	}
	close(start)
	wg.Wait()

	if got := successes.Load(); got != n {
		t.Errorf("successes = %d, want %d", got, n)
	}
	if got := other.Load(); got != 0 {
		t.Errorf("other errors = %d, want 0", got)
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != n {
		t.Fatalf("linux.csv data rows = %d, want %d", len(rows), n)
	}
	if idx.Count() != n {
		t.Fatalf("index count = %d, want %d", idx.Count(), n)
	}
}

// TestConcurrentDistinctTweetsAcrossFilesKeepRowsSeparated proves the global
// mutex keeps per-file appends coherent when concurrent saves target different
// CSVs.
func TestConcurrentDistinctTweetsAcrossFilesKeepRowsSeparated(t *testing.T) {
	store, idx, dir := newTestStore(t)

	targets := []struct {
		filename string
		count    int
	}{
		{"linux.csv", 6},
		{"ai.csv", 4},
	}

	// Every job gets a globally unique Status ID so this test exercises
	// contention, not the duplicate path.
	type job struct {
		filename string
		id       int
	}
	var jobs []job
	nextID := 2000
	for _, target := range targets {
		for i := 0; i < target.count; i++ {
			jobs = append(jobs, job{filename: target.filename, id: nextID})
			nextID++
		}
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	for _, j := range jobs {
		wg.Add(1)
		go func(j job) {
			defer wg.Done()
			<-start
			req := saveReq(j.filename, fmt.Sprintf("https://x.com/%s/status/%d", strings.TrimSuffix(j.filename, ".csv"), j.id), "body")
			if _, err := store.Save(req); err != nil {
				t.Errorf("Save(%s, %d) error = %v", j.filename, j.id, err)
			}
		}(j)
	}
	close(start)
	wg.Wait()

	for _, target := range targets {
		if rows := dataRows(t, dir, target.filename); len(rows) != target.count {
			t.Errorf("%s data rows = %d, want %d", target.filename, len(rows), target.count)
		}
	}
	if idx.Count() != len(jobs) {
		t.Fatalf("index count = %d, want %d", idx.Count(), len(jobs))
	}
}

// TestSaveSucceedsWhenIndexPersistFailsThenCSVRecoversIndex proves PRD §65 item
// 19 end to end: a failed derived-index write does not fail Save, logs a
// warning, and the index is fully recoverable from the CSV on restart.
func TestSaveSucceedsWhenIndexPersistFailsThenCSVRecoversIndex(t *testing.T) {
	dir := t.TempDir()
	idx := index.New()
	var logBuf bytes.Buffer
	store := storage.NewStore(dir, idx, logging.New(&logBuf))

	// Force index.Persist to fail deterministically: its rename target is a
	// non-empty directory.
	indexPath := filepath.Join(dir, "index.json")
	if err := os.Mkdir(indexPath, 0o700); err != nil {
		t.Fatalf("mkdir index.json: %v", err)
	}

	resp, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "durable"))
	if err != nil {
		t.Fatalf("Save() error = %v, want success despite index persistence failure", err)
	}
	if resp.Status != "saved" {
		t.Fatalf("response status = %q, want saved", resp.Status)
	}
	logged := logBuf.String()
	if !strings.Contains(logged, "index persistence failed") {
		t.Errorf("expected an index-persistence warning in the log, got: %s", logged)
	}
	if strings.Contains(logged, "durable") {
		t.Errorf("log leaked tweet text: %s", logged)
	}

	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Fatalf("linux.csv data rows = %d, want 1", len(rows))
	}
	if idx.Count() != 1 {
		t.Fatalf("in-memory index count = %d, want 1", idx.Count())
	}

	// Simulate restart after the obstacle is removed: the CSV alone rebuilds
	// the full index.
	if err := os.Remove(indexPath); err != nil {
		t.Fatalf("remove blocking index.json dir: %v", err)
	}
	recovered, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() after failed persist error = %v", err)
	}
	if recovered.Count() != 1 {
		t.Fatalf("recovered index count = %d, want 1 (rebuilt from CSV)", recovered.Count())
	}
	if _, ok := recovered.Lookup("123"); !ok {
		t.Fatalf("recovered index missing tweet 123")
	}
}
