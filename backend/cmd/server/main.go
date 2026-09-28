// Command server runs the local Twitter Bookmarker backend.
//
// It binds 127.0.0.1 only, creates the storage directory (0700) when missing,
// opens tw-bookmarker.db there — creating it on first run — and serves the HTTP
// API plus the built web app.
//
// The database is the whole of the server's persistence. There is no other file
// format it reads or writes, and no import mode: anything that ever needs to
// write into the database does so over the API.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"twitter-bookmarker/internal/api"
	"twitter-bookmarker/internal/config"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/storage"
)

const (
	serverName      = "twitter-bookmarker-server"
	shutdownTimeout = 10 * time.Second
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", serverName, err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	for _, arg := range args {
		switch arg {
		case "-h", "--help":
			printUsage(stdout)
			return nil
		default:
			return fmt.Errorf("unknown argument %q (try -h)", arg)
		}
	}

	log := logging.New(os.Stderr)

	dir, err := config.EnsureStorageDir()
	if err != nil {
		return fmt.Errorf("storage directory: %w", err)
	}

	// Opening the store creates the database on a fresh install and fails loudly
	// on a corrupt or unrecognised one, rather than starting up with an empty
	// gallery.
	store, err := storage.NewStore(dir, log)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()

	stats, err := store.Stats()
	if err != nil {
		return err
	}

	handler := api.NewServer(store, log)

	// Listen explicitly first so a port clash is reported before serving.
	ln, err := net.Listen("tcp", config.Addr())
	if err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			return fmt.Errorf("port %d is already in use (%s)", config.Port, config.Addr())
		}
		return fmt.Errorf("listen on %s: %w", config.Addr(), err)
	}

	srv := &http.Server{
		Addr:              config.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Startup(serverName, config.Addr(), dir, stats.Collections, stats.Posts)

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.Serve(ln)
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case <-ctx.Done():
		log.Shutdown()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		return nil
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve: %w", err)
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintf(w,
		"Usage: %s\n\n"+
			"Starts the local Twitter Bookmarker backend on %s.\n"+
			"Storage directory: $%s, or ~/%s when that is unset.\n"+
			"The database is %s inside it, and it is the only file the server owns.\n\n"+
			"  -h, --help  show this help and exit\n",
		serverName, config.Addr(), config.EnvDir, config.DirName, config.DBName)
}
