/**
 * Benchmark runner. Streams synthesized abc/ tunes through the SAME worker
 * pipeline the app uses (src/audio/worker.js) with deterministicClock, so
 * detector timing depends on audio position, not wall clock — runs are
 * reproducible. Detectors and tunes are selectable so runs stay short.
 */

import { synthesizeTune } from './abc-synth.js';
import { mixNoise, hashString } from './noise.js';
import { TUNES, getTune } from './tunes.js';
import { getDetectorIds } from '../detection/factory.js';
import { detectionToNoteSafety } from '../detection/note-safety-aggregator.js';
import { computeNoteSafetyMetrics, summarizeNoteSafety } from './note-safety-metrics.js';
import noteSafetyMetadata from '../../abc/metadata.json';

export const DEFAULT_OPTIONS = {
  detectors: null, // null = all from factory.js
  tunes: null, // null = all abc/ fixtures
  durationSec: 30,
  sampleRate: 44100,
  chunkSize: 4096,
  noise: { type: 'none', snrDb: 10, seed: 1 }
};

const RUN_TIMEOUT_MS = 120_000;

function runSingle({ detectorId, pcm, sampleRate, chunkSize }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../audio/worker.js', import.meta.url), { type: 'module' });
    const updates = [];
    let finalDetection = null;
    let startedAt = 0;

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Benchmark run timed out for detector '${detectorId}'`));
    }, RUN_TIMEOUT_MS);

    const finish = (fn, value) => {
      clearTimeout(timeout);
      worker.terminate();
      fn(value);
    };

    worker.onerror = (err) => finish(reject, new Error(`Worker error (${detectorId}): ${err.message}`));
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'detector_error') {
        finish(reject, new Error(`Detector '${detectorId}' failed to init: ${data.message}`));
      } else if (data.type === 'detector_ready') {
        // Feed all chunks, then flush. Worker handles messages in order, so
        // flush_done means every chunk has been processed.
        startedAt = performance.now();
        for (let offset = 0; offset < pcm.length; offset += chunkSize) {
          worker.postMessage(pcm.slice(offset, offset + chunkSize));
        }
        worker.postMessage({ type: 'flush' });
      } else if (data.type === 'detection_update') {
        updates.push({
          audioProcessedMs: data.audioProcessedMs,
          tonic: data.detection.tonic,
          mode: data.detection.mode,
          confidence: data.detection.confidence
        });
        finalDetection = data.detection; // full result (candidates + chroma) for note safety
      } else if (data.type === 'flush_done') {
        finish(resolve, { updates, finalDetection, wallMs: Math.round(performance.now() - startedAt) });
      }
    };

    worker.postMessage({
      type: 'init',
      detectorId,
      sampleRate,
      bufferSize: chunkSize,
      deterministicClock: true
    });
  });
}

function isCorrect(update, expected) {
  return update && update.tonic === expected.tonic && update.mode === expected.mode;
}

function computeMetrics({ updates, finalDetection, wallMs }, expected, meta) {
  const final = updates.length ? updates[updates.length - 1] : null;
  let firstCorrectMs = null;
  let settledMs = null;
  for (const update of updates) {
    if (isCorrect(update, expected)) {
      if (firstCorrectMs === null) firstCorrectMs = update.audioProcessedMs;
      if (settledMs === null) settledMs = update.audioProcessedMs;
    } else {
      settledMs = null; // wrong again — not settled yet
    }
  }

  // Product output: safe/careful/avoid notes scored against jam metadata.
  const noteSafety = detectionToNoteSafety(finalDetection);
  const noteSafetyMetrics = computeNoteSafetyMetrics(noteSafety, meta);

  return {
    // Note safety = the product answer (IMPLEMENTATION.md Phase 4).
    noteSafety: noteSafety
      ? { status: noteSafety.status, safe: noteSafety.safe, careful: noteSafety.careful, avoid: noteSafety.avoid, ambiguity: noteSafety.ambiguity }
      : null,
    noteSafetyMetrics,
    // Exact key correctness kept as debug/comparison only.
    correct: isCorrect(final, expected),
    final: final ? { tonic: final.tonic, mode: final.mode, confidence: final.confidence } : null,
    firstCorrectMs, // audio ms when the detector was first right
    settledMs, // audio ms after which it stayed right until the end
    updateCount: updates.length,
    wallMs, // real processing time for the whole run (perf comparison)
    updates
  };
}

/**
 * Runs the selected (tunes x detectors) matrix sequentially (parallel runs
 * would distort wallMs). Audio per tune is synthesized once and reused for
 * every detector. Noise seed is mixed with the tune name so a tune gets the
 * same noise regardless of which other tunes are selected.
 *
 * @param {object} options see DEFAULT_OPTIONS
 * @param {(msg: string, done: number, total: number) => void} [onProgress]
 * @returns {Promise<Array<object>>} one result row per (tune, detector)
 */
export async function runBenchmark(options = {}, onProgress = () => {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options, noise: { ...DEFAULT_OPTIONS.noise, ...(options.noise || {}) } };
  const detectorIds = opts.detectors && opts.detectors.length ? opts.detectors : getDetectorIds();
  const tuneNames = opts.tunes && opts.tunes.length ? opts.tunes : TUNES.map(t => t.name);

  const results = [];
  const total = tuneNames.length * detectorIds.length;
  let done = 0;

  for (const tuneName of tuneNames) {
    const tune = getTune(tuneName);
    const clean = synthesizeTune(tune.text, { sampleRate: opts.sampleRate, durationSec: opts.durationSec });
    const pcm = mixNoise(clean, {
      ...opts.noise,
      seed: (opts.noise.seed ^ hashString(tuneName)) >>> 0
    }, opts.sampleRate);

    for (const detectorId of detectorIds) {
      onProgress(`${tuneName} × ${detectorId}`, done, total);
      let row;
      try {
        const run = await runSingle({ detectorId, pcm, sampleRate: opts.sampleRate, chunkSize: opts.chunkSize });
        row = { tune: tuneName, expected: tune.expected, detectorId, ...computeMetrics(run, tune.expected, noteSafetyMetadata[tuneName]) };
      } catch (err) {
        row = { tune: tuneName, expected: tune.expected, detectorId, error: err.message, correct: false };
      }
      results.push(row);
      done++;
      onProgress(`${tuneName} × ${detectorId}`, done, total);
    }
  }
  return results;
}

/** Per-detector accuracy + average timing rollup of runBenchmark() rows. */
export function summarize(results) {
  const byDetector = new Map();
  for (const row of results) {
    if (!byDetector.has(row.detectorId)) {
      byDetector.set(row.detectorId, { detectorId: row.detectorId, runs: 0, correct: 0, errors: 0, settledMsSum: 0, settledCount: 0, wallMsSum: 0 });
    }
    const acc = byDetector.get(row.detectorId);
    acc.runs++;
    if (row.error) acc.errors++;
    if (row.correct) acc.correct++;
    if (row.settledMs != null) { acc.settledMsSum += row.settledMs; acc.settledCount++; }
    if (row.wallMs != null) acc.wallMsSum += row.wallMs;
  }
  const noteSafetyByDetector = new Map(summarizeNoteSafety(results).map(s => [s.detectorId, s]));

  return [...byDetector.values()].map(acc => {
    const ns = noteSafetyByDetector.get(acc.detectorId);
    return {
      detectorId: acc.detectorId,
      runs: acc.runs,
      // Note-safety = product metrics (IMPLEMENTATION.md Phase 4).
      noteSafetyScore: ns ? ns.avgScore : 0,
      safePrecision: ns ? ns.avgSafePrecision : 0,
      safeRecall: ns ? ns.avgSafeRecall : 0,
      dangerousGreenTotal: ns ? ns.dangerousGreenTotal : 0,
      avoidFalseNegativeTotal: ns ? ns.avoidFalseNegativeTotal : 0,
      // Exact key correctness kept as debug/comparison only.
      correct: acc.correct,
      errors: acc.errors,
      accuracy: acc.runs ? acc.correct / acc.runs : 0,
      avgSettledMs: acc.settledCount ? Math.round(acc.settledMsSum / acc.settledCount) : null,
      avgWallMs: acc.runs ? Math.round(acc.wallMsSum / acc.runs) : null
    };
  }).sort((a, b) => b.noteSafetyScore - a.noteSafetyScore || b.accuracy - a.accuracy);
}
