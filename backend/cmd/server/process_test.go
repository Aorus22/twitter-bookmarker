package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"twitter-bookmarker/internal/config"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

// serverBin is built once in TestMain and shared by every process-level test.
var serverBin string

const (
	procBuildTimeout     = 5 * time.Minute
	procStartupTimeout   = 30 * time.Second
	procShutdownWait     = 20 * time.Second
	procFailureExitLimit = 20 * time.Second
)

func TestMain(m *testing.M) {
	buildDir, err := os.MkdirTemp("", "twbm-server-build-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "create build dir:", err)
		os.Exit(1)
	}
	serverBin = filepath.Join(buildDir, "twitter-bookmarker-server")

	ctx, cancel := context.WithTimeout(context.Background(), procBuildTimeout)
	build := exec.CommandContext(ctx, "go", "build", "-o", serverBin, ".")
	out, err := build.CombinedOutput()
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "go build failed: %v\n%s", err, out)
		_ = os.RemoveAll(buildDir)
		os.Exit(1)
	}

	code := m.Run()
	_ = os.RemoveAll(buildDir)
	os.Exit(code)
}

// TestProcessLiveServer proves PRD §65 items 1, 2, 3, 4, 5 and 6 against a real
// compiled binary over a real TCP socket, then proves clean termination.
func TestProcessLiveServer(t *testing.T) {
	requireDefaultPortFree(t)

	home := t.TempDir()
	p := startServer(t, home)
	waitForHealth(t, p)

	// Item 4: GET /health.
	status, body := httpDo(t, http.MethodGet, "/health", "")
	if status != http.StatusOK {
		t.Fatalf("GET /health status = %d, want 200", status)
	}
	if got := decodeBody[model.HealthResponse](t, body).Status; got != "ok" {
		t.Fatalf("health body status = %q, want ok", got)
	}

	// Item 3: the storage directory is created automatically with mode 0700.
	storageDir := filepath.Join(home, config.DirName)
	fi, err := os.Stat(storageDir)
	if err != nil {
		t.Fatalf("storage directory %s was not created: %v", storageDir, err)
	}
	if !fi.IsDir() {
		t.Fatalf("storage path %s is not a directory", storageDir)
	}
	if perm := fi.Mode().Perm(); perm != 0o700 {
		t.Fatalf("storage dir mode = %04o, want 0700", perm)
	}

	// Item 2: the startup log reports the loopback address, never a wildcard.
	logOut := p.out.String()
	if !strings.Contains(logOut, "Twitter Bookmarker server started") {
		t.Errorf("startup log missing server-started message:\n%s", logOut)
	}
	if !strings.Contains(logOut, config.Addr()) {
		t.Errorf("startup log missing loopback address %s:\n%s", config.Addr(), logOut)
	}
	if strings.Contains(logOut, "0.0.0.0") {
		t.Errorf("startup log suggests a non-loopback bind:\n%s", logOut)
	}

	// Item 6: POST /v1/bookmarks creates the CSV.
	saveBody := `{"filename":"linux.csv","tweet":{"url":"https://x.com/foo/status/123?s=20","author":"Foo Bar","username":"@foo","tweet_date":"2026-09-27T01:00:00Z","text":"Testing Linux today"}}`
	status, body = httpDo(t, http.MethodPost, "/v1/bookmarks", saveBody)
	if status != http.StatusCreated {
		t.Fatalf("POST /v1/bookmarks status = %d, want 201 (body %s)", status, body)
	}
	saved := decodeBody[model.SaveResponse](t, body)
	if saved.Status != "saved" || saved.TweetID != "123" {
		t.Fatalf("save response = %+v, want status=saved tweet_id=123", saved)
	}
	csvPath := filepath.Join(storageDir, "linux.csv")
	raw, err := os.ReadFile(csvPath)
	if err != nil {
		t.Fatalf("linux.csv was not created in the storage dir: %v", err)
	}
	first := strings.SplitN(strings.TrimRight(string(raw), "\r\n"), "\n", 2)[0]
	if first != storage.Header {
		t.Fatalf("csv header = %q, want %q", first, storage.Header)
	}

	// Item 5: GET /v1/index returns the saved tweet.
	status, body = httpDo(t, http.MethodGet, "/v1/index", "")
	if status != http.StatusOK {
		t.Fatalf("GET /v1/index status = %d, want 200", status)
	}
	if _, ok := decodeBody[model.IndexResponse](t, body).Items["123"]; !ok {
		t.Fatalf("index does not contain tweet 123: %s", body)
	}

	// Item 1 + PRD §58: the running process terminates cleanly on SIGTERM.
	if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("signal SIGTERM: %v", err)
	}
	if err := p.waitExit(t, procShutdownWait); err != nil {
		t.Fatalf("server exit = %v, want code 0 after SIGTERM", err)
	}
	if logOut := p.out.String(); !strings.Contains(logOut, "shutdown signal received") {
		t.Errorf("shutdown log missing clean-shutdown message:\n%s", logOut)
	}
}

// TestProcessGracefulShutdownSignals proves PRD §58 for both SIGINT and
// SIGTERM: exit code 0 and a clean shutdown log line.
func TestProcessGracefulShutdownSignals(t *testing.T) {
	signals := []struct {
		name string
		sig  syscall.Signal
	}{
		{"SIGINT", syscall.SIGINT},
		{"SIGTERM", syscall.SIGTERM},
	}
	for _, tc := range signals {
		t.Run(tc.name, func(t *testing.T) {
			requireDefaultPortFree(t)

			p := startServer(t, t.TempDir())
			waitForHealth(t, p)

			if err := p.cmd.Process.Signal(tc.sig); err != nil {
				t.Fatalf("signal %s: %v", tc.name, err)
			}
			if err := p.waitExit(t, procShutdownWait); err != nil {
				t.Fatalf("%s exit = %v, want code 0; output:\n%s", tc.name, err, p.out.String())
			}
			if logOut := p.out.String(); !strings.Contains(logOut, "shutdown signal received") {
				t.Errorf("%s shutdown log missing clean-shutdown message:\n%s", tc.name, logOut)
			}
		})
	}
}

// TestProcessPortInUseExitsNonZero proves PRD §57: if the port is already in
// use the process exits non-zero with a clear message.
func TestProcessPortInUseExitsNonZero(t *testing.T) {
	ln, err := net.Listen("tcp", config.Addr())
	if err != nil {
		t.Skipf("default port %s is unavailable so it cannot be reserved for this test: %v", config.Addr(), err)
	}
	defer ln.Close()

	p := startServer(t, t.TempDir())
	err = p.waitExit(t, procFailureExitLimit)
	if err == nil {
		t.Fatalf("expected non-zero exit when %s is in use, got exit code 0; output:\n%s", config.Addr(), p.out.String())
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("exit error = %v, want *exec.ExitError", err)
	}
	if code := exitErr.ExitCode(); code == 0 {
		t.Fatalf("exit code = %d, want non-zero", code)
	}
	if out := p.out.String(); !strings.Contains(out, "already in use") {
		t.Errorf("stderr missing a clear port-in-use message:\n%s", out)
	}
}

// TestProcessStorageDirFailureExitsNonZero proves PRD §57: if the storage
// directory cannot be created the process exits non-zero with a clear message.
func TestProcessStorageDirFailureExitsNonZero(t *testing.T) {
	// A regular file as $HOME makes ~/.twitter-bookmarker uncreatable
	// regardless of the process uid.
	homeFile := filepath.Join(t.TempDir(), "home-is-a-file")
	if err := os.WriteFile(homeFile, []byte("not a directory\n"), 0o600); err != nil {
		t.Fatalf("write home file: %v", err)
	}

	p := startServer(t, homeFile)
	err := p.waitExit(t, procFailureExitLimit)
	if err == nil {
		t.Fatalf("expected non-zero exit when the storage dir cannot be created, got exit code 0; output:\n%s", p.out.String())
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("exit error = %v, want *exec.ExitError", err)
	}
	if code := exitErr.ExitCode(); code == 0 {
		t.Fatalf("exit code = %d, want non-zero", code)
	}
	if out := p.out.String(); !strings.Contains(out, "storage directory") {
		t.Errorf("stderr missing a clear storage-directory message:\n%s", out)
	}
}

// --- process helpers ---

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

type serverProc struct {
	cmd       *exec.Cmd
	out       *lockedBuffer
	exited    chan struct{}
	mu        sync.Mutex
	waitErr   error
	waitErrOK bool
}

// startServer launches the compiled server with HOME redirected to home and
// registers cleanup that kills it if the test ends early.
func startServer(t *testing.T, home string) *serverProc {
	t.Helper()

	cmd := exec.Command(serverBin)
	cmd.Env = envWithHome(home)
	out := &lockedBuffer{}
	cmd.Stdout = out
	cmd.Stderr = out
	if err := cmd.Start(); err != nil {
		t.Fatalf("start server binary: %v", err)
	}

	p := &serverProc{cmd: cmd, out: out, exited: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		p.mu.Lock()
		p.waitErr, p.waitErrOK = err, true
		p.mu.Unlock()
		close(p.exited)
	}()

	t.Cleanup(func() {
		select {
		case <-p.exited:
		default:
			_ = cmd.Process.Kill()
			<-p.exited
		}
	})
	return p
}

func (p *serverProc) waitExit(t *testing.T, timeout time.Duration) error {
	t.Helper()
	select {
	case <-p.exited:
		p.mu.Lock()
		defer p.mu.Unlock()
		if !p.waitErrOK {
			t.Fatal("internal: exit observed before Wait result was recorded")
		}
		return p.waitErr
	case <-time.After(timeout):
		t.Fatalf("server did not exit within %s; output:\n%s", timeout, p.out.String())
		return nil
	}
}

func (p *serverProc) exitErr() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.waitErr
}

// envWithHome returns the parent environment with HOME replaced (not appended
// twice, which some libc getenv implementations resolve to the first entry).
func envWithHome(home string) []string {
	env := make([]string, 0, len(os.Environ())+1)
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "HOME=") {
			continue
		}
		env = append(env, kv)
	}
	return append(env, "HOME="+home)
}

// requireDefaultPortFree skips the test when the fixed production port cannot
// be reserved in this environment (e.g. a real backend is already running).
func requireDefaultPortFree(t *testing.T) {
	t.Helper()
	ln, err := net.Listen("tcp", config.Addr())
	if err != nil {
		t.Skipf("production port %s is unavailable in this environment: %v", config.Addr(), err)
	}
	_ = ln.Close()
}

func waitForHealth(t *testing.T, p *serverProc) {
	t.Helper()
	deadline := time.Now().Add(procStartupTimeout)
	for time.Now().Before(deadline) {
		select {
		case <-p.exited:
			t.Fatalf("server exited before becoming healthy: %v\noutput:\n%s", p.exitErr(), p.out.String())
		default:
		}

		status, _, err := httpGet(100 * time.Millisecond)
		if err == nil && status == http.StatusOK {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("server did not become healthy within %s; output:\n%s", procStartupTimeout, p.out.String())
}

func httpDo(t *testing.T, method, path, body string) (int, []byte) {
	t.Helper()
	status, data, err := httpRequest(method, path, body, 5*time.Second)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return status, data
}

func httpGet(timeout time.Duration) (int, []byte, error) {
	return httpRequest(http.MethodGet, "/health", "", timeout)
}

// httpRequest issues one request against the live server. Keep-alives are
// disabled so graceful shutdown never waits on pooled idle connections.
func httpRequest(method, path, body string, timeout time.Duration) (int, []byte, error) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, "http://"+config.Addr()+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, data, nil
}

func decodeBody[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode response %q: %v", body, err)
	}
	return v
}

// TestProcessRebuildIndexFlag proves `--rebuild-index` regenerates index.json
// from the CSVs — with the same header-aware parser the server uses — and then
// exits without opening a listener. The data migrates from the six-column
// layout to the seven-column one, so both must be indexed correctly.
func TestProcessRebuildIndexFlag(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, config.DirName)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir storage dir: %v", err)
	}

	migrated := strings.Join([]string{
		storage.Header,
		`https://x.com/foo/status/111,"[""https://pbs.twimg.com/media/A.jpg""]",Foo,@foo,2026-09-27T01:00:00Z,2026-09-27T02:00:00Z,"hi"`,
		`https://x.com/bar/status/222,[],Bar,@bar,2026-09-27T01:05:00Z,2026-09-27T02:05:00Z,"there"`,
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(dir, "linux.csv"), []byte(migrated), 0o600); err != nil {
		t.Fatalf("write linux.csv: %v", err)
	}

	legacy := strings.Join([]string{
		storage.LegacyHeader,
		`https://x.com/baz/status/333,Baz,@baz,2026-09-27T01:10:00Z,2026-09-27T02:10:00Z,"old"`,
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(dir, "old.csv"), []byte(legacy), 0o600); err != nil {
		t.Fatalf("write old.csv: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), procShutdownWait)
	defer cancel()
	cmd := exec.CommandContext(ctx, serverBin, "--rebuild-index")
	cmd.Env = envWithHome(home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("--rebuild-index exit = %v, want 0 (output:\n%s)", err, out)
	}
	if !strings.Contains(string(out), "rebuilt index.json from CSVs: 3 tweets") {
		t.Errorf("stdout missing the rebuild count:\n%s", out)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("index.json was not written: %v", err)
	}
	var file model.IndexFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("decode index.json: %v", err)
	}

	want := map[string]model.IndexEntry{
		"111": {URL: "https://x.com/foo/status/111", Filename: "linux.csv", SavedAt: "2026-09-27T02:00:00Z"},
		"222": {URL: "https://x.com/bar/status/222", Filename: "linux.csv", SavedAt: "2026-09-27T02:05:00Z"},
		"333": {URL: "https://x.com/baz/status/333", Filename: "old.csv", SavedAt: "2026-09-27T02:10:00Z"},
	}
	if len(file.Tweets) != len(want) {
		t.Fatalf("index has %d entries, want %d: %+v", len(file.Tweets), len(want), file.Tweets)
	}
	for id, wantEntry := range want {
		if got := file.Tweets[id]; got != wantEntry {
			t.Errorf("index[%s] = %+v, want %+v", id, got, wantEntry)
		}
	}
}
