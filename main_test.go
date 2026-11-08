package main

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestListenerFailureShutsDownPeer(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	peer := &http.Server{Addr: "127.0.0.1:0"}
	shutdown := make(chan struct{})
	peer.RegisterOnShutdown(func() { close(shutdown) })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := serveServers(ctx, &http.Server{Addr: occupied.Addr().String()}, peer); err == nil {
		t.Fatal("listener failure was hidden")
	}
	select {
	case <-shutdown:
	case <-ctx.Done():
		t.Fatal("failed listener left its peer running")
	}
}

func TestCancelledServerGroupShutsDownCleanly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := serveServers(ctx, &http.Server{Addr: "127.0.0.1:0"}, &http.Server{Addr: "127.0.0.1:0"}); err != nil {
		t.Fatal(err)
	}
}
