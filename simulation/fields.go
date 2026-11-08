package simulation

// requestFields preserves the partner's training-document import contract.
// Only request data is accepted; server-owned scores and decisions are rejected.
type requestFields struct {
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
