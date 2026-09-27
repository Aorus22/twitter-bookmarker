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

	// FileMode is the mode used for the storage directory.
	FileMode os.FileMode = 0o700
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
// from and would silently scatter CSVs across the disk.
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
