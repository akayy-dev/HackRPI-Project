import { TRAINING_EXAMPLES } from './training-examples.js';

const HEADER_FIELDS = {
  request_user_agent: 'User-Agent', request_referer: 'Referer', request_origin: 'Origin',
  request_cookie: 'Cookie', request_content_type: 'Content-Type', request_accept: 'Accept',
  request_accept_language: 'Accept-Language', request_accept_encoding: 'Accept-Encoding',
  request_do_not_track: 'DNT', request_connection: 'Connection',
};

// Convert the capture's timestamp into the API's RFC3339 time without shifting
// the clock or offset. The Go serializer converts it back to the capture format.
export function captureTimestamp(value) {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid training timestamp: ' + value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months.indexOf(match[2]) + 1;
  if (!month) throw new Error('Invalid training timestamp month');
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}T${match[4]}${match[5]}:${match[6]}`;
}

// Adapt reference request fields to the simulator API without modifying encoded
// paths or bodies. Empty headers stay absent, matching skip_empty in training.
export function fromTrainingExample(example) {
  const headers = {};
  for (const [field, name] of Object.entries(HEADER_FIELDS)) if (example[field]) headers[name] = [example[field]];
  return {
    timestamp: captureTimestamp(example.timestamp), method: example.request_http_method,
    url: example.request_http_request, host: example.request_host,
    remote_addr: example.src_ip + ':' + example.src_port,
    destination_addr: example.dst_ip + ':' + example.dst_port,
    protocol: example.request_http_protocol, headers,
    ...(example.request_body ? { body: example.request_body } : {}),
  };
}

export function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
const integer = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
let sequence = 0;
const token = () => (++sequence).toString(36) + Math.random().toString(36).slice(2, 7);
const word = () => pick(['garden', 'archive', 'travel', 'books', 'camera', 'summer', 'music', 'profile']);
const slug = () => word() + '-' + token();
const script = () => pick(['/blog/index.php', '/blog/search.php', '/shop/catalog.php', 'search.php', 'test.php']);

// Keep percent escapes and form-style + spaces compatible with the captures,
// while varying escape casing across newly generated payloads.
export function formEncode(value) {
  const lower = Math.random() < 0.5;
  return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+').replace(/%[0-9A-F]{2}/g, part => lower ? part.toLowerCase() : part);
}
function query(r, path, pairs) { r.url = path + '?' + pairs.map(([key, value]) => formEncode(key) + '=' + formEncode(String(value))).join('&'); }
function form(r, path, pairs) {
  r.method = 'POST'; r.url = path;
  r.headers['Content-Type'] = ['application/x-www-form-urlencoded'];
  r.body = pairs.map(([key, value]) => formEncode(key) + '=' + formEncode(String(value))).join('&');
}
function inject(r, payload, field = 'q') {
  if (Math.random() < 0.5) form(r, script(), [[field, payload], ['user', slug()]]);
  else query(r, script(), [[field, payload], ['page', token()]]);
}

// These functions create new payloads and request contexts. The bundled examples
// are used only by the explicit examples mode below, never by this default path.
export const ATTACKS = [
  { key: 'protocol_manipulation', label: 'Protocol manipulation', apply: r => { r.protocol = pick(['HTTP/0.9', 'HTTP/1.0', 'HTTP/2.0']); r.method = pick(['OPTIONS', 'TRACE']); r.headers.Connection = [pick(['upgrade', 'keep-alive, upgrade', 'close'])]; } },
  { key: 'code_injection', label: 'Code injection', apply: r => { const n = integer(2, 99); inject(r, pick([`<?php echo '${token()}'; ?>`, `{{${n}*${integer(2, 99)}}}`, '${'+n+'*'+integer(2, 99)+'}']), pick(['template', 'content', 'user_login'])); } },
  { key: 'os_command_injection', label: 'OS command injection', fixtures: ['command_injection'], apply: r => { const n = integer(1, 9); const command = pick(['`sleep '+n+'`', ';echo '+token(), '&& sleep '+n, '$(printf '+token()+')', '| echo '+token()]); inject(r, slug()+command, pick(['user_login', 'host', 'name'])); } },
  { key: 'path_traversal', label: 'Path traversal', fixtures: ['path_traversal'], apply: r => { const path = pick(['../', '..\\', '\\..']).repeat(integer(2, 12)) + pick(['etc/passwd', 'wp-config.php', 'windows/win.ini', 'var/log/access.log']); query(r, pick(['/blog/index.php/my-account/user-logout/', '/blog/download.php', '/assets/view.php']), [[pick(['file', 'path', '_wpnonce', 'template']), path], ['name', slug()]]); } },
  { key: 'sql_injection', label: 'SQL injection', fixtures: ['sql_injection', 'sql_injection_v2'], apply: r => { const n = integer(2, 999); const sql = pick([`' OR '${n}'='${n}' -- `, `' UNION SELECT ${Array(integer(1, 6)).fill('NULL').join(',')} -- `, `${integer(1, 999)} AND SLEEP(${integer(1, 9)})`, `' AND (${n}=${n}) -- `, `abc'/**/oR/**/'${n}'='${n}`, `';sleep ${integer(1, 9)};'`]); inject(r, sql, pick(['q', 'id', 'search', 'username', 'filter'])); } },
  { key: 'dictionary_password_attack', label: 'Password guessing', apply: r => { form(r, pick(['/blog/wp-login.php', '/login.php', '/account/login']), [['log', pick(['admin', 'root', 'webmaster', 'test'])], ['pwd', pick(['password', 'welcome', 'letmein', 'admin'])+integer(0, 9999)], ['redirect_to', '/account/'+token()], ['wp-submit', 'Log In']]); } },
  { key: 'vulnerability_scanning', label: 'Vulnerability scanning', apply: r => { query(r, pick(['/blog/wp-admin/install.php', '/blog/.git/config', '/blog/wp-config.php.bak', '/phpmyadmin/', '/server-status', '/.env']), [['ver', token()]]); r.method = pick(['GET', 'HEAD']); r.headers['User-Agent'] = [pick(['Nikto/', 'Nmap Scripting Engine/', 'sqlmap/'])+integer(1, 5)+'.'+integer(0, 9)]; } },
  { key: 'input_data_manipulation', label: 'Input manipulation', apply: r => { form(r, pick(['/blog/index.php/my-account/', '/shop/checkout.php', '/api/profile']), [[pick(['quantity', 'price', 'user_id']), String(-integer(1, 999999))], ['role', pick(['admin', 'administrator', 'superuser'])], ['item', slug()]]); } },
  { key: 'command_injection', label: 'Command injection', apply: r => { inject(r, slug()+pick([';echo ', '&& printf ', '| echo '])+token(), pick(['filename', 'command', 'convert'])); } },
  { key: 'http_verb_tampering', label: 'HTTP verb tampering', apply: r => { r.method = pick(['TRACE', 'CONNECT', 'DELETE', 'PUT', 'PROPFIND']); r.url = '/blog/wp-admin/'+slug()+'/'; } },
  { key: 'source_spoofing', label: 'Source spoofing', apply: r => { r.url = '/blog/wp-admin/'+slug()+'/'; r.headers['X-Forwarded-For'] = [pick(['127.0.0.1', '10.0.0.'+integer(1, 254), sourceIP()+', 127.0.0.1'])]; r.headers['X-Real-IP'] = ['127.0.0.'+integer(1, 254)]; } },
  { key: 'http_response_splitting', label: 'Response splitting', apply: r => { query(r, pick(['/blog/redirect.php', '/blog/wp-includes/js/jquery/jquery-migrate.min.js', '/go.php']), [[pick(['next', 'ver', 'redirect_to']), '/'+slug()+'\r\n'+pick(['Set-Cookie: Tamper=', 'X-Custom-Header: ', 'Location: /'])+token()]]); } },
  { key: 'http_request_smuggling', label: 'Request smuggling', apply: r => { r.method = 'POST'; r.url = '/blog/'+slug()+'/'; r.headers['Transfer-Encoding'] = [pick(['chunked', 'gzip, chunked'])]; r.headers['Content-Length'] = [String(integer(1, 12))]; r.body = '0\r\n\r\n'+pick(['GET', 'POST'])+' /blog/wp-admin/'+slug()+'/ HTTP/1.1\r\nHost: '+r.host+'\r\nX-Request-ID: '+token()+'\r\n\r\n'; } },
];

// These synthetic public-format source addresses are never contacted.
export function sourceIP() {
  return pick(['23.45', '45.79', '51.15', '80.240', '103.1', '139.59', '185.199', '200.160']) + '.' + Math.floor(Math.random() * 256) + '.' + (1 + Math.floor(Math.random() * 254));
}

function generatedBase(sourceProfile) {
  const month = integer(1, 12);
  const day = integer(1, new Date(Date.UTC(2020, month, 0)).getUTCDate());
  const pad = n => String(n).padStart(2, '0');
  const ip = sourceProfile === 'training' ? '172.26.0.'+pick([1, 2, 3, 5, 6, 7, 9, 10, 11, 13]) : sourceIP();
  const request = {
    timestamp: `2020-${pad(month)}-${pad(day)}T${pad(integer(0, 23))}:${pad(integer(0, 59))}:${pad(integer(0, 59))}${pick(['+01:00', '+02:00', '+00:00'])}`,
    method: pick(['GET', 'GET', 'HEAD']), url: '/blog/index.php/'+slug()+'/',
    host: pick(['test-site.com', 'www.test-site.com', 'shop.test-site.com']),
    remote_addr: ip+':'+integer(1024, 65535), destination_addr: '172.26.0.'+pick([4, 8, 12])+':80', protocol: 'HTTP/1.1',
    headers: {
      'User-Agent': [pick(['Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.155 Safari/537.36'])],
      Accept: [pick(['*/*', 'text/html,application/xhtml+xml', 'application/json'])],
      'Accept-Encoding': [pick(['gzip, deflate', 'gzip, deflate, br'])], Connection: [pick(['keep-alive', 'close'])],
    },
  };
  if (Math.random() < 0.3) request.headers.Referer = ['http://'+request.host+'/blog/'+word()+'/'];
  if (Math.random() < 0.25) form(request, '/blog/profile.php', [['display_name', word()+' '+token()], ['email', token()+'@example.test']]);
  return request;
}

// Generated is the default: new payload/context combinations, rather than stored
// examples or metadata-only mutations. Exact replay is an explicit diagnostic mode.
export function makeRequest(maliciousPercent, selectedAttacks, sourceProfile = 'public', generationMode = 'generated') {
  const malicious = Math.random() * 100 < maliciousPercent;
  let request;
  let scenario;
  if (generationMode === 'examples') {
    if (malicious) {
      const available = selectedAttacks.filter(attack => attack.fixtures?.length);
      if (!available.length) throw new Error('Select a category with an available reference example.');
      scenario = pick(available);
      request = fromTrainingExample(TRAINING_EXAMPLES[pick(scenario.fixtures)]);
    } else request = fromTrainingExample(TRAINING_EXAMPLES[pick(['normal', 'normal_v2'])]);
  } else {
    request = generatedBase(sourceProfile);
    if (malicious && selectedAttacks.length) { scenario = pick(selectedAttacks); scenario.apply(request); }
  }
  request.intended_classification = 'normal';
  let label = 'Normal';
  if (scenario) {
    request.intended_classification = scenario.key; label = scenario.label;
  }
  request.generation_mode = generationMode;
  const ip = request.remote_addr.split(':')[0];
  return { request, ip, label };
}
