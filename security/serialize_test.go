package security

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSerializeRequestMatchesTrainingFields(t *testing.T) {
	now := time.Date(2026, time.November, 7, 19, 25, 55, 0, time.UTC)
	body := "id=1"
	r := httptest.NewRequest(http.MethodPost, "http://test-site.com/login?user=admin", strings.NewReader(body))
	r.RequestURI = "/login?user=admin"
	r.RemoteAddr = "172.26.0.1:57628"
	r.Host = "test-site.com"
	r.Header.Set("User-Agent", "curl/8.0")
	r.Header.Set("Referer", "http://ref/")
	r.Header.Set("Origin", "http://test-site.com")
	r.Header.Set("Cookie", "session=abc")
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Accept", "*/*")
	r.Header.Set("Accept-Language", "en")
	r.Header.Set("Accept-Encoding", "gzip")
	r.Header.Set("DNT", "1")
	r.Header.Set("Connection", "keep-alive")
	r.Header.Set("Authorization", "Bearer secret-token")
	r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, &net.TCPAddr{
		IP:   net.ParseIP("172.26.0.4"),
		Port: 80,
	}))

	text, err := SerializeRequest(r, 256, now)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		"timestamp: 07/Nov/2026:19:25:55 +0000",
		"src-ip: 172.26.0.1",
		"src-port: 57628",
		"dst-ip: 172.26.0.4",
		"dst-port: 80",
		"method: POST",
		"path: /login?user=admin",
		"protocol: HTTP/1.1",
		"user-agent: curl/8.0",
		"referer: http://ref/",
		"host: test-site.com",
		"origin: http://test-site.com",
		"cookie: session=abc",
		"content-type: application/x-www-form-urlencoded",
		"accept: */*",
		"accept-language: en",
		"accept-encoding: gzip",
		"do-not-track: 1",
		"connection: keep-alive",
		"body: id=1",
	}, "\n")
	if text != want {
		t.Fatalf("serialized request\n%s\nwant\n%s", text, want)
	}
	if strings.Contains(text, "secret-token") || strings.Contains(text, "Authorization") {
		t.Fatal("authorization header was copied into the classifier input")
	}
	got, err := io.ReadAll(r.Body)
	if err != nil || string(got) != body {
		t.Fatalf("body after classification = %q, %v", got, err)
	}
	if r.Header.Get("Authorization") != "Bearer secret-token" {
		t.Fatal("authorization header changed")
	}
}

func TestSerializeRequestUsesHostPortWhenLocalAddressIsMissing(t *testing.T) {
	now := time.Date(2026, time.November, 7, 19, 25, 55, 0, time.UTC)
	r := httptest.NewRequest(http.MethodGet, "http://app.example:8080/", nil)
	r.RequestURI = "/"
	r.RemoteAddr = "[2001:db8::1]:51515"
	r.Host = "app.example:8080"
	r.Header.Set("Accept", "text/html")
	r.Header.Add("Accept", "application/json")

	text, err := SerializeRequest(r, 256, now)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		"timestamp: 07/Nov/2026:19:25:55 +0000",
		"src-ip: 2001:db8::1",
		"src-port: 51515",
		"dst-port: 8080",
		"method: GET",
		"path: /",
		"protocol: HTTP/1.1",
		"host: app.example",
		"accept: text/html, application/json",
	}, "\n")
	if text != want {
		t.Fatalf("serialized request\n%s\nwant\n%s", text, want)
	}
}

func TestSerializeRequestKeepsBytesBeyondTheClassificationLimit(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "http://example.test/upload", strings.NewReader("abcdef"))
	r.RequestURI = "/upload"
	text, err := SerializeRequest(r, 4, time.Unix(0, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "body: abcd") || strings.Contains(text, "body: abcde") {
		t.Fatalf("classification body was not limited: %s", text)
	}
	got, err := io.ReadAll(r.Body)
	if err != nil || string(got) != "abcdef" {
		t.Fatalf("forwarded body = %q, %v", got, err)
	}
	if err := r.Body.Close(); err != nil {
		t.Fatal(err)
	}
}
