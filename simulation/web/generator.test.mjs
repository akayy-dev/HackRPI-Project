import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, makeRequest, sourceIP } from './generator.js';

test('all 13 attack categories generate request telemetry, not predictions', () => {
  assert.equal(ATTACKS.length, 13);
  assert.equal(new Set(ATTACKS.map(a => a.key)).size, 13);
  for (const attack of ATTACKS) {
    const { request, label, ip } = makeRequest(100, [attack]);
    assert.equal(request.intended_classification, attack.key);
    assert.equal(label, attack.label);
    assert.equal(request.remote_addr.split(':')[0], ip);
    assert.match(request.url, /^\//);
    assert.ok(request.method && request.headers && request.host && request.timestamp);
    assert.equal('attack_probabilities' in request, false);
    assert.equal('risk' in request, false);
  }
});

test('zero malicious traffic always generates normal requests', () => {
  for (let i = 0; i < 100; i++) {
    const { request } = makeRequest(0, ATTACKS);
    assert.equal(request.intended_classification, 'normal');
    assert.equal(request.method, 'GET');
  }
});

test('source IPs are valid public-format IPv4 addresses', () => {
  for (let i = 0; i < 500; i++) {
    const parts = sourceIP().split('.').map(Number);
    assert.equal(parts.length, 4);
    assert.ok(parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255));
    assert.ok(![0, 10, 127, 169, 172, 192, 198, 224, 255].includes(parts[0]));
  }
});
