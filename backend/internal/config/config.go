// Package config holds the fixed, non-configurable backend settings: the
// loopback bind address and the storage directory under the user's home.
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
)

const (
	// Port is the single source of truth for the backend port. It is not
	// configurable from the extension UI in the MVP.
	Port = 43121

	// Host binds the server to loopback only. Never 0.0.0.0.
	Host = "127.0.0.1"

	// DirName is the storage directory name inside the user's home directory.
	DirName = ".twitter-bookmarker"

	// FileMode is the mode used for the storage directory.
	FileMode os.FileMode = 0o700
)

// Addr returns the loopback listen address, e.g. "127.0.0.1:43121".
func Addr() string {
	return net.JoinHostPort(Host, strconv.Itoa(Port))
}

// StorageDir resolves ~/.twitter-bookmarker without creating it.
//
// It uses os.UserHomeDir (which honours $HOME on Unix), so tests can redirect
// it with t.Setenv("HOME", t.TempDir()).
func StorageDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	if home == "" {
		return "", fmt.Errorf("resolve user home directory: empty home path")
	}
	return filepath.Join(home, DirName), nil
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
