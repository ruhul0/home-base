// Command server runs the Home Base website and API, and is the only part of the app that talks to MySQL.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const (
	listenAddress     = ":3000"
	publicDirectory   = "public"
	databaseWait      = 60 * time.Second
	shutdownWait      = 10 * time.Second
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 60 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := openStore(ctx, databaseWait)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer store.close()

	if err := store.migrate(ctx); err != nil {
		return fmt.Errorf("upgrade database: %w", err)
	}

	server := &http.Server{
		Addr:              listenAddress,
		Handler:           newApp(store, publicDirectory).routes(),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}

	failed := make(chan error, 1)
	go func() {
		log.Printf("Listening on %s", listenAddress)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
	}()

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), shutdownWait)
	defer cancel()
	return server.Shutdown(shutdownContext)
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
