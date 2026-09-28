// Package config holds the backend settings: the loopback bind address and the
// storage directory (overridable through the environment).
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	// Port is the single source of truth for the backend port. It is not
	// configurable from the extension UI in the MVP.
	Port = 43121

	// Host binds the server to loopback only. Never 0.0.0.0.
	Host = "127.0.0.1"

	// DirName is the storage directory name inside the user's home directory.
	// It is only the default: EnvDir overrides it.
	DirName = ".twitter-bookmarker"

	// EnvDir names the environment variable that relocates the storage
	// directory anywhere on disk, e.g.
	//
	//	TWITTER_BOOKMARKER_DIR=~/Personal/twitter-bookmarker
	//
	// An empty or unset value keeps the historical ~/.twitter-bookmarker, so
	// existing installs are unaffected. The data-cleaning scripts in the data
	// repository read the same variable.
	EnvDir = "TWITTER_BOOKMARKER_DIR"

	// DBName is the SQLite database inside the storage directory. It is the one
	// durable file the backend owns; the gallery serves nothing but what it
	// reads from here.
	DBName = "tw-bookmarker.db"

	// FileMode is the mode used for the storage directory.
	FileMode os.FileMode = 0o700

	// DBFileMode is the mode used for a database this process creates. The
	// database holds the same personal data the per-category CSVs used to, and
	// those were 0o600; the directory is 0o700 as well, so this is defence in
	// depth rather than the only protection. It is applied only on creation, so
	// a mode the user chose for an existing file is never overwritten.
	DBFileMode os.FileMode = 0o600

	// WebDirName is the default location of the built single-page app,
	// relative to the repository root (and therefore to the directory
	// `make run` starts the server from).
	WebDirName = "web/dist"

	// EnvWebDir names the environment variable that points the server at a
	// different built SPA directory, e.g.
	//
	//	TWITTER_BOOKMARKER_WEB_DIR=/tmp/dist-fixture
	//
	// It exists for tests and for unusual layouts. When set it is
	// authoritative: WebDir never silently falls back to another candidate,
	// so a test can point the server at a missing directory on purpose and
	// observe the degraded behaviour.
	EnvWebDir = "TWITTER_BOOKMARKER_WEB_DIR"
)

// Addr returns the loopback listen address, e.g. "127.0.0.1:43121".
func Addr() string {
	return net.JoinHostPort(Host, strconv.Itoa(Port))
}

// StorageDir resolves the storage directory without creating it.
//
// It honours $TWITTER_BOOKMARKER_DIR when set, and otherwise falls back to
// ~/.twitter-bookmarker. It uses os.UserHomeDir (which honours $HOME on Unix),
// so tests can redirect it with t.Setenv("HOME", t.TempDir()).
func StorageDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	if home == "" {
		return "", fmt.Errorf("resolve user home directory: empty home path")
	}
	return resolveStorageDir(os.Getenv(EnvDir), home)
}

// resolveStorageDir turns the raw environment value into an absolute path.
//
// An empty value yields the historical default. A leading "~/" is expanded to
// the user's home; anything else must already be absolute, because a relative
// path would depend on the working directory the server happens to be started
// from, so the same install could end up with two different databases.
func resolveStorageDir(raw, home string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return filepath.Join(home, DirName), nil
	}
	if value == "~" || strings.HasPrefix(value, "~"+string(filepath.Separator)) {
		value = filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(value, "~"), string(filepath.Separator)))
	}
	if !filepath.IsAbs(value) {
		return "", fmt.Errorf("%s must be an absolute path or start with ~/ (got %q)", EnvDir, raw)
	}
	return filepath.Clean(value), nil
}

// WebDir resolves the directory that serves the built SPA (PRD-2 §11, §84)
// without requiring it to exist.
//
// The resolution order is:
//
//  1. $TWITTER_BOOKMARKER_WEB_DIR, verbatim — absolute, or relative to the
//     current working directory. When set it is the only candidate, so a
//     missing directory is reported as such rather than masked by a fallback.
//  2. <cwd>/web/dist — `make run` and a plain `./backend/bin/...` from the
//     repository root both resolve here.
//  3. <exeDir>/web/dist, <exeDir>/../web/dist, <exeDir>/../../web/dist — a
//     binary installed at the repo root, in backend/ or in backend/bin/
//     finds the tree even when the server is started from elsewhere.
//
// The first candidate that exists as a directory wins. When none exists it
// returns the primary candidate (<cwd>/web/dist) with ok=false so the caller
// can log the expected location and keep serving the API (PROD-05).
func WebDir() (string, bool) {
	cwd, _ := os.Getwd()
	exeDir := ""
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}
	return resolveWebDir(os.Getenv(EnvWebDir), cwd, exeDir)
}

// resolveWebDir is WebDir's pure core: it takes the raw environment value and
// the two base directories so the precedence can be tested without chdir and
// without depending on where the test binary happens to live.
//
// An empty cwd or exeDir simply drops that group of candidates.
func resolveWebDir(rawEnv, cwd, exeDir string) (string, bool) {
	if value := strings.TrimSpace(rawEnv); value != "" {
		abs, err := filepath.Abs(value)
		if err != nil {
			abs = filepath.Clean(value)
		}
		return abs, isDir(abs)
	}

	candidates := make([]string, 0, 4)
	if cwd != "" {
		candidates = append(candidates, filepath.Join(cwd, WebDirName))
	}
	if exeDir != "" {
		candidates = append(candidates,
			filepath.Join(exeDir, WebDirName),
			filepath.Join(exeDir, "..", WebDirName),
			filepath.Join(exeDir, "..", "..", WebDirName),
		)
	}
	for _, candidate := range candidates {
		if isDir(candidate) {
			return filepath.Clean(candidate), true
		}
	}
	if len(candidates) > 0 {
		return filepath.Clean(candidates[0]), false
	}
	return WebDirName, false
}

// isDir reports whether path is an existing directory.
func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// EnsureStorageDir resolves, creates (mode 0700) and returns the storage dir.
func EnsureStorageDir() (string, error) {
	dir, err := StorageDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, FileMode); err != nil {
		return "", fmt.Errorf("create storage directory %s: %w", dir, err)
	}
	// MkdirAll leaves the mode of a pre-existing directory untouched, so an
	// explicit chmod guarantees 0700 even if the directory already existed.
	if err := os.Chmod(dir, FileMode); err != nil {
		return "", fmt.Errorf("set permissions on storage directory %s: %w", dir, err)
	}
	return dir, nil
}

// DBPath is the database file inside dir, e.g. "/data/tw-bookmarker.db".
func DBPath(dir string) string { return filepath.Join(dir, DBName) }
