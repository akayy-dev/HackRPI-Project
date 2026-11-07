// Request fixtures from the user-supplied training archive, examples_request/.
// Values and encoding are preserved; these are classifier inputs, never network targets.
export const TRAINING_EXAMPLES = {
  "command_injection": {
    "timestamp": "18/Jul/2020:05:53:48 +0200",
    "src_ip": "172.26.0.1",
    "src_port": "57802",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "POST",
    "request_http_request": "test.php",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0",
    "request_host": "test-site.com",
    "request_content_type": "application/x-www-form-urlencoded",
    "request_body": "user_login=amazedMeerkat9%60sleep+15%60&redirect_to=&wp-submit=Get+New+Password"
  },
  "normal": {
    "timestamp": "29/Jul/2020:08:32:42 +0100",
    "src_ip": "172.26.0.1",
    "src_port": "49518",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "GET",
    "request_http_request": "/",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.155 Safari/537.36",
    "request_host": "test-site.com",
    "request_accept": "*/*",
    "request_accept_encoding": "gzip, deflate",
    "request_connection": "keep-alive"
  },
  "normal_v2": {
    "timestamp": "29/Jul/2020:08:32:42 +0100",
    "src_ip": "172.26.0.1",
    "src_port": "49518",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "GET",
    "request_http_request": "/go/to/sleep",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.155 Safari/537.36",
    "request_host": "test-site.com",
    "request_accept": "*/*",
    "request_accept_encoding": "gzip, deflate",
    "request_connection": "keep-alive"
  },
  "path_traversal": {
    "timestamp": "17/Jul/2020:21:54:21 +0200",
    "src_ip": "172.26.0.1",
    "src_port": "64808",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "GET",
    "request_http_request": "/blog/index.php/my-account/user-logout/?_wpnonce=%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0",
    "request_host": "test-site.com"
  },
  "sql_injection": {
    "timestamp": "18/Jul/2020:05:26:36 +0200",
    "src_ip": "172.26.0.1",
    "src_port": "57628",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "GET",
    "request_http_request": "/blog/wp-content/uploads/2020/04/b476e717-efec-3b0d-80e9-13c6400a7702-300x240.png%27%3Bsleep+15%3B%27",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0",
    "request_host": "test-site.com"
  },
  "sql_injection_v2": {
    "timestamp": "18/Jul/2020:05:31:12 +0200",
    "src_ip": "172.26.0.1",
    "src_port": "58104",
    "dst_ip": "172.26.0.4",
    "dst_port": "80",
    "request_http_method": "GET",
    "request_http_request": "search.php?q=abc%27%2f%2a%2a%2foR%2f%2a%2a%2f%271%27%3d%271",
    "request_http_protocol": "HTTP/1.1",
    "request_user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0",
    "request_host": "test-site.com"
  }
};
