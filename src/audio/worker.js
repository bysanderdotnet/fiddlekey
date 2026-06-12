/**
 * Fiddlekey Web Worker
 * Receives PCM chunks from the main thread (originally from AudioWorklet)
 * and passes them to the configured KeyDetector.
 *
 * With `deterministicClock` enabled (benchmark mode), Date.now() inside the
 * detector is pinned to the amount of audio processed so far, so runs are
 * reproducible regardless of wall-clock speed.
 */

import { DEFAULT_DETECTOR_ID, createDetector } from '../detection/factory.js';

let detector = null;
let sampleRate = 44100;
let processedSamples = 0;
let deterministicClock = false;
const realDateNow = Date.now.bind(Date);
if (typeof document === "undefined") { globalThis.document = { currentScript: null, createElement: () => ({}) }; }
if (typeof window === "undefined") { globalThis.window = globalThis; }

self.onmessage = async (event) => {
  const data = event.data;

  if (data.type === 'init') {
    sampleRate = data.sampleRate || 44100;
    const bufferSize = data.bufferSize || 4096;
    const detectorId = data.detectorId || DEFAULT_DETECTOR_ID;
    processedSamples = 0;
    deterministicClock = data.deterministicClock === true;

    if (detector) {
      detector.destroy();
    }

    try {
      detector = await createDetector(detectorId);
      await detector.init(sampleRate, bufferSize);

      console.log(`[Worker] Initialized detector '${detectorId}' with sampleRate: ${sampleRate}, bufferSize: ${bufferSize}`);
    } catch (err) {
      console.error('[Worker] Failed to initialize detector:', err);
      self.postMessage({ type: 'detector_error', detectorId, message: err.message });
    }
    return;
  }

  if (data.type === 'reset') {
    if (detector) detector.resetHistory();
    processedSamples = 0;
    return;
  }

  if (data.type === 'destroy') {
    if (detector) {
      detector.destroy();
      detector = null;
    }
    processedSamples = 0;
    return;
  }

  const pcmChunk = data;

  if (pcmChunk instanceof Float32Array) {
    if (!detector) return; // Wait for initialization
    processedSamples += pcmChunk.length;

    try {
      const audioProcessedMs = Math.round((processedSamples / sampleRate) * 1000);
      let result;

      if (deterministicClock) {
        self.postMessage({ type: 'benchmark_audio_progress', audioProcessedMs });
        Date.now = () => audioProcessedMs;
      }

      try {
        result = detector.process(pcmChunk);
      } finally {
        if (deterministicClock) Date.now = realDateNow;
      }

      if (result) {
        self.postMessage({
          type: 'detection_update',
          detection: result,
          audioProcessedMs
        });
      }
    } catch (err) {
      console.warn('[Worker] Detector failed to process audio chunk:', err);
    }
  } else {
    console.warn('[Worker] Received unknown message:', event.data);
  }
};
