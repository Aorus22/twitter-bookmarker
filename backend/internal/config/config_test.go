package config_test

import (
	"os"
	"path/filepath"
	"strings"
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
	t.Setenv(config.EnvDir, "")

	got, err := config.StorageDir()
	if err != nil {
		t.Fatalf("StorageDir() error = %v", err)
	}
	want := filepath.Join(home, config.DirName)
	if got != want {
		t.Fatalf("StorageDir() = %q, want %q", got, want)
	}
}

func TestStorageDirHonoursEnvOverride(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	override := filepath.Join(t.TempDir(), "vault")
	t.Setenv(config.EnvDir, override)

	got, err := config.StorageDir()
	if err != nil {
		t.Fatalf("StorageDir() error = %v", err)
	}
	if got != override {
		t.Fatalf("StorageDir() = %q, want the override %q", got, override)
	}
	if strings.HasPrefix(got, home) {
		t.Fatalf("StorageDir() = %q still lives under the home directory", got)
	}
}

func TestStorageDirEnvCases(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cases := []struct {
		name    string
		value   string
		want    string
		wantErr bool
	}{
		{name: "unset", value: "", want: filepath.Join(home, config.DirName)},
		{name: "whitespace only", value: "   ", want: filepath.Join(home, config.DirName)},
		{name: "absolute", value: "/var/tmp/tbm", want: "/var/tmp/tbm"},
		{name: "tilde slash", value: "~/Personal/twitter-bookmarker", want: filepath.Join(home, "Personal/twitter-bookmarker")},
		{name: "tilde only", value: "~", want: home},
		{name: "trailing slash cleaned", value: "/var/tmp/tbm/", want: "/var/tmp/tbm"},
		{name: "dot segments cleaned", value: "/var/tmp/./tbm/../tbm", want: "/var/tmp/tbm"},
		{name: "surrounding space trimmed", value: "  /var/tmp/tbm  ", want: "/var/tmp/tbm"},
		{name: "relative rejected", value: "relative/dir", wantErr: true},
		{name: "tilde user rejected", value: "~other/dir", wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(config.EnvDir, tc.value)
			got, err := config.StorageDir()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("StorageDir() = %q, want an error", got)
				}
				if !strings.Contains(err.Error(), config.EnvDir) {
					t.Fatalf("error %q should name %s", err, config.EnvDir)
				}
				return
			}
			if err != nil {
				t.Fatalf("StorageDir() error = %v", err)
			}
			if got != tc.want {
				t.Fatalf("StorageDir() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEnsureStorageDirCreatesOverride(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	override := filepath.Join(t.TempDir(), "nested", "vault")
	t.Setenv(config.EnvDir, override)

	dir, err := config.EnsureStorageDir()
	if err != nil {
		t.Fatalf("EnsureStorageDir() error = %v", err)
	}
	if dir != override {
		t.Fatalf("EnsureStorageDir() = %q, want %q", dir, override)
	}
	fi, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat storage dir: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o700 {
		t.Fatalf("storage dir mode = %04o, want 0700", perm)
	}
}

func TestEnsureStorageDirRejectsRelativeOverride(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(config.EnvDir, "relative")

	if _, err := config.EnsureStorageDir(); err == nil {
		t.Fatal("EnsureStorageDir() accepted a relative override")
	}
}

func TestEnsureStorageDirCreates0700AndRepairs(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv(config.EnvDir, "")

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
