// Command server runs the local Twitter Bookmarker backend.
//
// It binds 127.0.0.1 only, creates ~/.twitter-bookmarker/ (0700) when missing,
// loads or rebuilds the derived index from CSV files, and serves the HTTP API.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"twitter-bookmarker/internal/api"
	"twitter-bookmarker/internal/config"
	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/storage"
)

const (
	serverName      = "twitter-bookmarker-server"
	shutdownTimeout = 10 * time.Second
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", serverName, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	for _, arg := range args {
		switch arg {
		case "-h", "--help":
			fmt.Fprintf(os.Stdout,
				"Usage: %s\n\nStarts the local Twitter Bookmarker backend on %s.\nStorage directory: ~/%s\n",
				serverName, config.Addr(), config.DirName)
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

	idx, err := index.LoadOrRebuild(dir, log)
	if err != nil {
		return fmt.Errorf("load index: %w", err)
	}

	store := storage.NewStore(dir, idx, log)
	handler := api.NewServer(store, idx, log)

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

	log.Startup(serverName, config.Addr(), dir, idx.Count())

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
