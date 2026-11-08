import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ATTACKS, makeRequest, sourceIP, fromTrainingExample, captureTimestamp } from './generator.js';
import { TRAINING_EXAMPLES } from './training-examples.js';

test('all 13 attack categories generate request telemetry, not predictions', () => {
  assert.equal(ATTACKS.length, 13);
  assert.equal(new Set(ATTACKS.map(a => a.key)).size, 13);
  for (const attack of ATTACKS) {
    const { request, label, ip } = makeRequest(100, [attack]);
    assert.equal(request.intended_classification, attack.key);
    assert.equal(label, attack.label);
    assert.equal(request.remote_addr.split(':')[0], ip);
    assert.ok(request.url.length > 0);
    assert.match(request.destination_addr, /^172\.26\.0\.(4|8|12):80$/);
    assert.ok(request.method && request.headers && request.host && request.timestamp);
    assert.equal('attack_probabilities' in request, false);
    assert.equal('risk' in request, false);
  }
});

test('bundled examples are unchanged from the supplied training archive', async () => {
  for (const [name, example] of Object.entries(TRAINING_EXAMPLES)) {
    const fixture = JSON.parse(await readFile(new URL('../../classifier/embeddings/testdata/training_examples/'+name+'.json',import.meta.url)));
    assert.deepEqual(example,fixture);
    const request = fromTrainingExample(example);
    assert.equal(request.url,example.request_http_request);
    assert.equal(request.body || '',example.request_body || '');
    assert.equal(request.remote_addr,example.src_ip+':'+example.src_port);
    assert.equal(request.host,example.request_host);
    assert.equal(request.headers['User-Agent'][0],example.request_user_agent);
  }
});

test('timestamp adaptation preserves the original clock and offset', () => {
  assert.equal(captureTimestamp('18/Jul/2020:05:53:48 +0200'),'2020-07-18T05:53:48+02:00');
});

test('reference scenarios replay exact supplied payloads only in explicit examples mode', () => {
  const traversal = makeRequest(100,ATTACKS.filter(a=>a.key==='path_traversal'),'public','examples').request;
  assert.equal(traversal.url,TRAINING_EXAMPLES.path_traversal.request_http_request);
  const command = makeRequest(100,ATTACKS.filter(a=>a.key==='os_command_injection'),'public','examples').request;
  assert.equal(command.url,'test.php');
  assert.equal(command.body,TRAINING_EXAMPLES.command_injection.request_body);
  for (let i=0;i<20;i++) {
    const sql = makeRequest(100,ATTACKS.filter(a=>a.key==='sql_injection'),'public','examples').request;
    assert.ok([TRAINING_EXAMPLES.sql_injection.request_http_request,TRAINING_EXAMPLES.sql_injection_v2.request_http_request].includes(sql.url));
  }
});

test('new samples and public addresses are default; private addresses still vary', () => {
  const request = makeRequest(0,[]);
  assert.equal(request.request.generation_mode,'generated');
  assert.ok(!request.ip.startsWith('172.26.0.'));
  const ips = new Set(Array.from({length:100},()=>makeRequest(0,[],'training').ip));
  assert.ok(ips.size > 1);
  assert.ok([...ips].every(ip=>ip.startsWith('172.26.0.')));
  const replay = makeRequest(0,[],'public','examples').request;
  assert.equal(replay.remote_addr,'172.26.0.1:49518');
  assert.equal(replay.generation_mode,'examples');
});

test('zero malicious traffic always generates normal requests', () => {
  for (let i = 0; i < 100; i++) {
    const { request } = makeRequest(0, ATTACKS);
    assert.equal(request.intended_classification, 'normal');
    assert.ok(['GET','HEAD','POST'].includes(request.method));
  }
});

// Inspect only fields that reach the model, excluding source/destination metadata,
// timestamps, and intended labels. Novel IPs alone must not satisfy this check.
test('default mode generates distinct request content for every category', () => {
  const fixtureContents = new Set(Object.values(TRAINING_EXAMPLES).map(example=>JSON.stringify([example.request_http_method,example.request_http_request,example.request_body || ''])));
  for (const attack of ATTACKS) {
    const contents = new Set();
    for (let i=0;i<100;i++) {
      const request = makeRequest(100,[attack]).request;
      const content = JSON.stringify([request.method,request.url,request.body || '']);
      assert.equal(request.generation_mode,'generated');
      assert.equal(fixtureContents.has(content),false,attack.key+' replayed a supplied fixture');
      assert.ok(Number.isFinite(Date.parse(request.timestamp)));
      contents.add(content);
    }
    assert.equal(contents.size,100,attack.key+' repeated request content');
  }
});

test('normal requests vary content as well as metadata', () => {
  const content = new Set();
  const methods = new Set();
  for (let i=0;i<100;i++) {
    const request = makeRequest(0,[]).request;
    content.add(JSON.stringify([request.method,request.url,request.body || '']));
    methods.add(request.method);
  }
  assert.equal(content.size,100);
  assert.ok(methods.size > 1);
});

test('SQL generation varies payload grammar, parameters, encoding, and carriers', () => {
  const attack = ATTACKS.find(a=>a.key==='sql_injection');
  const carriers = new Set(), fields = new Set(), families = new Set();
  for (let i=0;i<300;i++) {
    const request = makeRequest(100,[attack]).request;
    const query = request.url.includes('?');
    carriers.add(query ? 'query' : 'body');
    const params = new URLSearchParams(query ? request.url.split('?')[1] : request.body);
    const [field,payload] = params.entries().next().value;
    fields.add(field);
    families.add(payload.includes('UNION') ? 'union' : /SLEEP|sleep/.test(payload) ? 'timing' : payload.includes('/**/') ? 'comments' : 'boolean');
    assert.ok(!/%(?:[^a-fA-F0-9]|[a-fA-F0-9](?:[^a-fA-F0-9]|$))/.test(query ? request.url : request.body));
  }
  assert.equal(carriers.size,2);
  assert.equal(families.size,4);
  assert.ok(fields.size >= 4);
});

test('unsupported reference categories cannot silently become synthetic samples', () => {
  assert.throws(()=>makeRequest(100,ATTACKS.filter(a=>a.key==='code_injection'),'public','examples'),/reference example/);
});

test('source IPs are valid public-format IPv4 addresses', () => {
  for (let i = 0; i < 500; i++) {
    const parts = sourceIP().split('.').map(Number);
    assert.equal(parts.length, 4);
    assert.ok(parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255));
    assert.ok(![0, 10, 127, 169, 172, 192, 198, 224, 255].includes(parts[0]));
  }
});
