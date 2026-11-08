package security

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// SerializeRequest renders an incoming request as the plain-text block the
// threat classifier was trained on. Fields follow the Valendra request
// contract and empty values are omitted. The request body is restored before
// return so a forwarded request still contains every original byte.
func SerializeRequest(r *http.Request, maxBody int64, now time.Time) (string, error) {
	if maxBody <= 0 {
		return "", fmt.Errorf("classifier body limit must be positive")
	}
	body, err := captureBody(r, maxBody)
	if err != nil {
		return "", err
	}
	if body != "" && !utf8.ValidString(body) {
		slog.Debug("Omitting request body from classification because it is not valid UTF-8")
		body = ""
	}

	srcIP, srcPort := splitHostPort(r.RemoteAddr)
	dstIP, dstPort := "", ""
	if addr, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok && addr != nil {
		dstIP, dstPort = splitHostPort(addr.String())
	}
	host, hostPort := splitHostPort(r.Host)
	if dstPort == "" {
		dstPort = hostPort
	}

	var b strings.Builder
	write := func(label, value string) {
		if value == "" {
			return
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(label)
		b.WriteString(": ")
		b.WriteString(value)
	}
	write("timestamp", now.Format("02/Jan/2006:15:04:05 -0700"))
	write("src-ip", srcIP)
	write("src-port", srcPort)
	write("dst-ip", dstIP)
	write("dst-port", dstPort)
	write("method", r.Method)
	write("path", requestTarget(r))
	write("protocol", r.Proto)
	write("user-agent", headerValue(r.Header, "User-Agent"))
	write("referer", headerValue(r.Header, "Referer"))
	write("host", host)
	write("origin", headerValue(r.Header, "Origin"))
	write("cookie", headerValue(r.Header, "Cookie"))
	write("content-type", headerValue(r.Header, "Content-Type"))
	write("accept", headerValue(r.Header, "Accept"))
	write("accept-language", headerValue(r.Header, "Accept-Language"))
	write("accept-encoding", headerValue(r.Header, "Accept-Encoding"))
	write("do-not-track", headerValue(r.Header, "DNT"))
	write("connection", headerValue(r.Header, "Connection"))
	write("body", body)
	return b.String(), nil
}

func requestTarget(r *http.Request) string {
	if r.RequestURI != "" {
		return r.RequestURI
	}
	if r.URL == nil {
		return ""
	}
	return r.URL.RequestURI()
}

func headerValue(h http.Header, name string) string {
	values := h.Values(name)
	if len(values) == 0 {
		return ""
	}
	if strings.EqualFold(name, "Cookie") {
		return strings.Join(values, "; ")
	}
	return strings.Join(values, ", ")
}

func splitHostPort(hostport string) (string, string) {
	if hostport == "" {
		return "", ""
	}
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return hostport, ""
	}
	return host, port
}

func captureBody(r *http.Request, maxBody int64) (string, error) {
	if r.Body == nil || r.Body == http.NoBody {
		return "", nil
	}
	original := r.Body
	buf, err := io.ReadAll(io.LimitReader(original, maxBody+1))
	if err != nil {
		_ = original.Close()
		r.Body = http.NoBody
		return "", fmt.Errorf("read request body: %w", err)
	}
	if int64(len(buf)) > maxBody {
		r.Body = &restoreBody{Reader: io.MultiReader(bytes.NewReader(buf), original), close: original.Close}
		return string(buf[:maxBody]), nil
	}
	_ = original.Close()
	r.Body = io.NopCloser(bytes.NewReader(buf))
	return string(buf), nil
}

type restoreBody struct {
	io.Reader
	close func() error
}

func (b *restoreBody) Close() error {
	if b.close == nil {
		return nil
	}
	return b.close()
}
