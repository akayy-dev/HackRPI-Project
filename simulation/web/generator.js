// These templates only become classifier input. No generated URL is fetched.
export const ATTACKS = [
  { key: 'protocol_manipulation', label: 'Protocol manipulation', apply: r => { r.protocol = 'HTTP/0.9'; r.headers.Connection = ['keep-alive, upgrade']; } },
  { key: 'code_injection', label: 'Code injection', apply: r => { r.url = '/render?template=' + encodeURIComponent('{{7*7}}'); } },
  { key: 'os_command_injection', label: 'OS command injection', apply: r => { r.url = '/diagnostics?host=' + encodeURIComponent('127.0.0.1 && echo simulation'); } },
  { key: 'path_traversal', label: 'Path traversal', apply: r => { r.url = '/download?file=' + encodeURIComponent('../../../../etc/passwd'); } },
  { key: 'sql_injection', label: 'SQL injection', apply: r => { r.url = '/products?id=' + encodeURIComponent("1' OR '1'='1' --"); } },
  { key: 'dictionary_password_attack', label: 'Password guessing', apply: r => { r.method = 'POST'; r.url = '/login'; r.body = 'username=admin&password=' + pick(['password123', 'admin', 'welcome', 'letmein']); r.headers['Content-Type'] = ['application/x-www-form-urlencoded']; } },
  { key: 'vulnerability_scanning', label: 'Vulnerability scanning', apply: r => { r.url = pick(['/.env', '/wp-admin/install.php', '/.git/config', '/phpmyadmin/']); r.headers['User-Agent'] = ['Nikto/2.5.0 (simulation)']; } },
  { key: 'input_data_manipulation', label: 'Input manipulation', apply: r => { r.method = 'POST'; r.url = '/checkout'; r.body = '{"quantity":-999,"price":0,"role":"admin"}'; r.headers['Content-Type'] = ['application/json']; } },
  { key: 'command_injection', label: 'Command injection', apply: r => { r.url = '/convert?filename=' + encodeURIComponent('image.png; echo simulation'); } },
  { key: 'http_verb_tampering', label: 'HTTP verb tampering', apply: r => { r.method = 'TRACE'; r.url = '/admin/users'; } },
  { key: 'source_spoofing', label: 'Source spoofing', apply: r => { r.url = '/admin'; r.headers['X-Forwarded-For'] = ['127.0.0.1']; r.headers['X-Real-IP'] = ['127.0.0.1']; } },
  { key: 'http_response_splitting', label: 'Response splitting', apply: r => { r.url = '/redirect?next=' + encodeURIComponent('/home\r\nX-Simulated-Header: injected'); } },
  { key: 'http_request_smuggling', label: 'Request smuggling', apply: r => { r.method = 'POST'; r.url = '/'; r.headers['Transfer-Encoding'] = ['chunked']; r.headers['Content-Length'] = ['4']; r.body = '0\r\n\r\nGET /admin HTTP/1.1\r\nHost: app.example.test\r\n\r\n'; } },
];

export function pick(items) { return items[Math.floor(Math.random() * items.length)]; }

// Public address prefixes give IP databases routable-format inputs. They do not
// claim a particular city or identify real clients, and are never contacted.
export function sourceIP() {
  return pick(['23.45', '45.79', '51.15', '80.240', '103.1', '139.59', '185.199', '200.160']) + '.' + Math.floor(Math.random() * 256) + '.' + (1 + Math.floor(Math.random() * 254));
}

export function makeRequest(maliciousPercent, selectedAttacks) {
  const ip = sourceIP();
  const request = {
    timestamp: new Date().toISOString(), method: 'GET', url: pick(['/', '/products?category=books', '/about', '/api/catalog?page=2', '/contact']),
    host: 'app.example.test', remote_addr: ip + ':' + (10000 + Math.floor(Math.random() * 55000)), protocol: 'HTTP/1.1',
    headers: { 'User-Agent': ['Mozilla/5.0 (Traffic Lab simulation)'], Accept: ['text/html,application/json'], 'Accept-Language': ['en-US,en;q=0.9'] },
    intended_classification: 'normal',
  };
  let label = 'Normal';
  if (Math.random() * 100 < maliciousPercent && selectedAttacks.length) {
    const scenario = pick(selectedAttacks);
    scenario.apply(request);
    request.intended_classification = scenario.key;
    label = scenario.label;
  }
  return { request, ip, label };
}
