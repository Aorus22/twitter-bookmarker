package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"twitter-bookmarker/internal/config"
)

func TestFixedLoopbackAddress(t *testing.T) {
	if config.Host != "127.0.0.1" {
		t.Fatalf("Host = %q, want 127.0.0.1", config.Host)
	}
	if config.Port != 43121 {
		t.Fatalf("Port = %d, want 43121", config.Port)
	}
	if got := config.Addr(); got != "127.0.0.1:43121" {
		t.Fatalf("Addr() = %q, want 127.0.0.1:43121", got)
	}
}

func TestStorageDirFollowsHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	got, err := config.StorageDir()
	if err != nil {
		t.Fatalf("StorageDir() error = %v", err)
	}
	want := filepath.Join(home, config.DirName)
	if got != want {
		t.Fatalf("StorageDir() = %q, want %q", got, want)
	}
}

func TestEnsureStorageDirCreates0700AndRepairs(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	dir, err := config.EnsureStorageDir()
	if err != nil {
		t.Fatalf("EnsureStorageDir() error = %v", err)
	}
	fi, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat storage dir: %v", err)
	}
	if !fi.IsDir() {
		t.Fatalf("storage path %q is not a directory", dir)
	}
	if perm := fi.Mode().Perm(); perm != 0o700 {
		t.Fatalf("storage dir mode = %04o, want 0700", perm)
	}

	// A pre-existing directory with loose permissions must be repaired.
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	if _, err := config.EnsureStorageDir(); err != nil {
		t.Fatalf("EnsureStorageDir() second call error = %v", err)
	}
	fi, err = os.Stat(dir)
	if err != nil {
		t.Fatalf("stat storage dir: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o700 {
		t.Fatalf("storage dir mode after repair = %04o, want 0700", perm)
	}
}
