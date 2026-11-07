import { ATTACKS, makeRequest } from './generator.js';

const $ = id => document.getElementById(id);
const selectedByDefault = new Set(['sql_injection', 'path_traversal', 'vulnerability_scanning']);
for (const [index, attack] of ATTACKS.entries()) {
  const label = document.createElement('label'); label.className = 'attack-option';
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = attack.key; input.checked = selectedByDefault.has(attack.key);
  const text = document.createElement('span'); text.textContent = attack.label;
  const number = document.createElement('span'); number.className = 'attack-index'; number.textContent = String(index + 1).padStart(2, '0');
  label.append(input, text, number); $('attackTypes').append(label);
}

const stats = { sent: 0, accepted: 0, rejected: 0, errors: 0, active: 0 };
let running = false, paused = false, draining = false, nextDispatch = 0, runSent = 0, runLimit = 250, continuous = false;
let paintPending = false;
const completions = [];
const rows = [];

function selectedAttacks() {
  const keys = new Set([...document.querySelectorAll('#attackTypes input:checked')].map(input => input.value));
  return ATTACKS.filter(attack => keys.has(attack.key));
}

function validate() {
  const invalid = Number($('malicious').value) > 0 && !selectedAttacks().length;
  $('validationMessage').textContent = invalid ? 'Select at least one attack scenario, or set malicious traffic to 0%.' : '';
  $('start').disabled = invalid || draining;
  return !invalid;
}

function render() {
  paintPending = false;
  const decided = stats.accepted + stats.rejected;
  const accepted = decided ? stats.accepted / decided * 100 : 0;
  const rejected = decided ? stats.rejected / decided * 100 : 0;
  $('sent').textContent = stats.sent.toLocaleString(); $('inFlight').textContent = stats.active;
  $('acceptedCount').textContent = stats.accepted.toLocaleString(); $('rejectedCount').textContent = stats.rejected.toLocaleString();
  $('acceptedPercent').textContent = accepted.toFixed(1); $('rejectedPercent').textContent = rejected.toFixed(1);
  $('acceptedBar').style.width = accepted + '%'; $('rejectedBar').style.width = rejected + '%';
  $('errorCount').textContent = stats.errors.toLocaleString();
  const progress = runLimit ? Math.min(100, runSent / runLimit * 100) : 0;
  $('progressText').textContent = continuous ? '∞' : progress.toFixed(0) + '%';
  $('progressFill').style.width = continuous ? (running ? '100%' : '0%') : progress + '%';
  $('emptyState').hidden = rows.length > 0;
  $('logCount').textContent = rows.length.toLocaleString() + ' recent evaluations';
  $('reset').disabled = running || draining || stats.active > 0;
  $('stop').disabled = (!running && !paused) || draining;
  $('batchSize').disabled = running || paused || draining || $('continuous').checked;
  $('continuous').disabled = running || paused || draining;
  $('start').textContent = running ? 'Ⅱ Pause simulation' : paused ? '▶ Resume simulation' : '▶ Start simulation';
  $('runState').className = 'run-state ' + (running ? 'running' : paused ? 'paused' : '');
  $('stateText').textContent = draining ? 'Finishing evaluations…' : running ? 'Simulation running' : paused ? 'Simulation paused' : stats.sent ? 'Session complete' : 'Ready to simulate';
  validate();
}

function scheduleRender() { if (!paintPending) { paintPending = true; requestAnimationFrame(render); } }

function addRow(ip, intended, decision) {
  const row = document.createElement('tr');
  const address = document.createElement('td'); address.textContent = ip;
  const label = document.createElement('td'); label.textContent = intended;
  const state = document.createElement('td');
  const badge = document.createElement('span'); badge.className = 'decision ' + decision.toLowerCase(); badge.textContent = decision;
  state.append(badge); row.append(address, label, state); $('activityRows').prepend(row);
  rows.unshift(row); if (rows.length > 500) rows.pop().remove();
}

function finishIfDrained() {
  if (draining && stats.active === 0) { draining = false; paused = false; }
}

async function sendOne() {
  const { request, ip, label } = makeRequest(Number($('malicious').value), selectedAttacks());
  stats.sent++; runSent++; stats.active++; completions.push(performance.now()); scheduleRender();
  try {
    const response = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok || typeof result.blocked !== 'boolean') throw new Error(result.classification_error || result.error || 'Evaluation failed');
    if (result.blocked) stats.rejected++; else stats.accepted++;
    addRow(ip, label, result.blocked ? 'Rejected' : 'Accepted');
  } catch (error) {
    stats.errors++; addRow(ip, label, 'Error');
    $('lastError').hidden = false; $('lastError').textContent = 'Latest evaluation error: ' + error.message;
  } finally {
    stats.active--; finishIfDrained(); scheduleRender();
  }
}

function tick() {
  if (!running || draining || !validate()) return;
  if (!continuous && runSent >= runLimit) { running = false; draining = stats.active > 0; scheduleRender(); return; }
  const now = performance.now();
  if (now < nextDispatch || stats.active >= 8) return;
  nextDispatch = now + 1000 / Number($('rate').value);
  void sendOne();
}

$('start').addEventListener('click', () => {
  if (!validate()) return;
  if (running) { running = false; paused = true; }
  else {
    if (!paused) {
      const count = Number($('batchSize').value);
      if (!$('continuous').checked && (!Number.isInteger(count) || count < 1 || count > 100000)) {
        $('validationMessage').textContent = 'Enter a batch size between 1 and 100,000.'; return;
      }
      runSent = 0; runLimit = count; continuous = $('continuous').checked;
    }
    running = true; paused = false; nextDispatch = 0;
  }
  scheduleRender();
});
$('stop').addEventListener('click', () => { running = false; paused = false; draining = stats.active > 0; scheduleRender(); });
$('reset').addEventListener('click', () => {
  if (running || draining || stats.active) return;
  Object.assign(stats, { sent: 0, accepted: 0, rejected: 0, errors: 0, active: 0 });
  rows.length = 0; completions.length = 0; $('activityRows').replaceChildren(); $('lastError').hidden = true;
  paused = false; runSent = 0; continuous = false; scheduleRender();
});
for (const [id, all] of [['selectAll', true], ['selectNone', false]]) $(id).addEventListener('click', () => {
  for (const input of document.querySelectorAll('#attackTypes input')) input.checked = all;
  validate();
});
function updateControls() {
  $('rateValue').textContent = $('rate').value + ' req/s'; $('maliciousValue').textContent = $('malicious').value + '%';
  $('benignMix').textContent = 100 - Number($('malicious').value); $('attackMix').textContent = $('malicious').value;
  validate(); scheduleRender();
}
for (const id of ['rate', 'malicious', 'attackTypes', 'continuous']) $(id).addEventListener('input', updateControls);
setInterval(tick, 10);
setInterval(() => {
  const cutoff = performance.now() - 5000;
  while (completions.length && completions[0] < cutoff) completions.shift();
  $('actualRate').textContent = (completions.length / 5).toFixed(1);
}, 500);
updateControls(); render();
