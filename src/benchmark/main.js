/**
 * /benchmark page entry. UI wrapper around runner.js plus a programmatic
 * API (window.fiddlekeyBenchmark) so Playwright can inject runs:
 *
 *   await page.evaluate(() => window.fiddlekeyBenchmark.run({
 *     detectors: ['essentia'], tunes: ['c_major'], durationSec: 15,
 *     noise: { type: 'session', snrDb: 10, seed: 1 }
 *   }));
 */

import { runBenchmark, summarize } from './runner.js';
import { getDetectorOptions } from '../detection/factory.js';
import { TUNES } from './tunes.js';

const statusEl = document.getElementById('benchmark-status');
const runButton = document.getElementById('runBenchmark');
const summaryEl = document.getElementById('benchmark-summary');
const resultsEl = document.getElementById('benchmark-results');
const jsonEl = document.getElementById('benchmark-json');

function renderCheckboxes(containerId, items, groupName) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = groupName;
    input.value = item.id;
    input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(item.label));
    container.appendChild(label);
  }
}

renderCheckboxes('detector-checkboxes', getDetectorOptions(), 'detector');
renderCheckboxes('tune-checkboxes', TUNES.map(t => ({ id: t.name, label: `${t.name} (${t.expected.tonic} ${t.expected.mode})` })), 'tune');

function checkedValues(groupName) {
  return [...document.querySelectorAll(`input[name="${groupName}"]:checked`)].map(el => el.value);
}

function optionsFromUI() {
  return {
    detectors: checkedValues('detector'),
    tunes: checkedValues('tune'),
    durationSec: Number(document.getElementById('durationSec').value) || 30,
    noise: {
      type: document.getElementById('noiseType').value,
      snrDb: Number(document.getElementById('snrDb').value),
      seed: Number(document.getElementById('noiseSeed').value) || 1
    }
  };
}

function fmtMs(ms) {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

function renderResults(results) {
  const summary = summarize(results);

  summaryEl.innerHTML = '';
  const summaryTable = document.createElement('table');
  summaryTable.id = 'summary-table';
  summaryTable.innerHTML = `
    <thead><tr><th>Detector</th><th>Accuracy</th><th>Avg time to settle (audio)</th><th>Avg processing (wall)</th><th>Errors</th></tr></thead>`;
  const summaryBody = document.createElement('tbody');
  for (const row of summary) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.detectorId}</td><td>${row.correct}/${row.runs} (${Math.round(row.accuracy * 100)}%)</td><td>${fmtMs(row.avgSettledMs)}</td><td>${row.avgWallMs == null ? '—' : row.avgWallMs + 'ms'}</td><td>${row.errors}</td>`;
    summaryBody.appendChild(tr);
  }
  summaryTable.appendChild(summaryBody);
  summaryEl.appendChild(summaryTable);

  resultsEl.innerHTML = '';
  const table = document.createElement('table');
  table.id = 'results-table';
  table.innerHTML = `
    <thead><tr><th>Tune</th><th>Expected</th><th>Detector</th><th>Detected</th><th>First correct (audio)</th><th>Settled (audio)</th><th>Wall</th></tr></thead>`;
  const body = document.createElement('tbody');
  for (const row of results) {
    const tr = document.createElement('tr');
    tr.className = row.correct ? 'row-correct' : 'row-wrong';
    const detected = row.error
      ? `error: ${row.error}`
      : row.final ? `${row.final.tonic} ${row.final.mode}` : 'no detection';
    tr.innerHTML = `<td>${row.tune}</td><td>${row.expected.tonic} ${row.expected.mode}</td><td>${row.detectorId}</td><td>${detected}</td><td>${fmtMs(row.firstCorrectMs)}</td><td>${fmtMs(row.settledMs)}</td><td>${row.wallMs == null ? '—' : row.wallMs + 'ms'}</td>`;
    body.appendChild(tr);
  }
  table.appendChild(body);
  resultsEl.appendChild(table);

  jsonEl.textContent = JSON.stringify({ summary, results }, null, 2);
}

let running = false;

async function run(options) {
  if (running) throw new Error('Benchmark already running');
  running = true;
  runButton.disabled = true;
  try {
    const results = await runBenchmark(options, (label, done, total) => {
      statusEl.textContent = `Running ${label} (${done}/${total} done)`;
    });
    renderResults(results);
    statusEl.textContent = 'Done.';
    window.fiddlekeyBenchmark.lastResults = results;
    window.dispatchEvent(new CustomEvent('fiddlekey:benchmark-done', { detail: results }));
    return results;
  } catch (err) {
    statusEl.textContent = `Benchmark failed: ${err.message}`;
    throw err;
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => {
  run(optionsFromUI()).catch(err => console.error('Benchmark failed:', err));
});

window.fiddlekeyBenchmark = {
  run,
  summarize,
  lastResults: null,
  detectors: getDetectorOptions().map(d => d.id),
  tunes: TUNES.map(t => t.name)
};
