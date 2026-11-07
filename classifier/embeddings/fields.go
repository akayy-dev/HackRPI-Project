package embeddings

import "strings"

// SerializationFingerprint identifies REQUEST_FIELDS and skip_empty=True in the
// training archive. It matches metadata.cache_meta.serialize_fp in weights.json.
const SerializationFingerprint = "9059e530f7e4"

// ClassificationPrompt is the exact query prefix used to cache training vectors.
const ClassificationPrompt = "task: classification | query: "

// TimestampLayout matches the captured timestamps in examples_request/*.json.
const TimestampLayout = "02/Jan/2006:15:04:05 -0700"

// RequestFields is the training pipeline's 20-field request-only input schema.
// Values remain strings, including ports, encoded targets, and form bodies.
type RequestFields struct {
	Timestamp       string `json:"timestamp"`
	SourceIP        string `json:"src_ip"`
	SourcePort      string `json:"src_port"`
	DestinationIP   string `json:"dst_ip"`
	DestinationPort string `json:"dst_port"`
	Method          string `json:"request_http_method"`
	Target          string `json:"request_http_request"`
	Protocol        string `json:"request_http_protocol"`
	UserAgent       string `json:"request_user_agent"`
	Referer         string `json:"request_referer"`
	Host            string `json:"request_host"`
	Origin          string `json:"request_origin"`
	Cookie          string `json:"request_cookie"`
	ContentType     string `json:"request_content_type"`
	Accept          string `json:"request_accept"`
	AcceptLanguage  string `json:"request_accept_language"`
	AcceptEncoding  string `json:"request_accept_encoding"`
	DoNotTrack      string `json:"request_do_not_track"`
	Connection      string `json:"request_connection"`
	Body            string `json:"request_body"`
}

// SerializeRequest matches serialize_request in the supplied training code:
// fixed field order, exact labels and values, empty values skipped, no trailing
// newline. Headers outside this schema and response fields are excluded.
func SerializeRequest(r RequestFields) string {
	fields := [][2]string{
		{"timestamp", r.Timestamp}, {"src-ip", r.SourceIP}, {"src-port", r.SourcePort},
		{"dst-ip", r.DestinationIP}, {"dst-port", r.DestinationPort},
		{"method", r.Method}, {"path", r.Target}, {"protocol", r.Protocol},
		{"user-agent", r.UserAgent}, {"referer", r.Referer}, {"host", r.Host},
		{"origin", r.Origin}, {"cookie", r.Cookie}, {"content-type", r.ContentType},
		{"accept", r.Accept}, {"accept-language", r.AcceptLanguage},
		{"accept-encoding", r.AcceptEncoding}, {"do-not-track", r.DoNotTrack},
		{"connection", r.Connection}, {"body", r.Body},
	}
	lines := make([]string, 0, len(fields))
	for _, field := range fields {
		if field[1] != "" {
			lines = append(lines, field[0]+": "+field[1])
		}
	}
	return strings.Join(lines, "\n")
}
