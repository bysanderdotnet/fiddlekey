import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  keyExtractorResult: { key: 'D', scale: 'major', strength: 0.8 },
  keyExtractorCalls: []
}));

vi.mock('essentia.js/dist/essentia-wasm.es.js', () => ({ EssentiaWASM: {} }));

vi.mock('essentia.js/dist/essentia.js-core.es.js', () => ({
  default: class MockEssentia {
    arrayToVector(arr) {
      return { values: Array.from(arr), delete: () => {} };
    }

    KeyExtractor(...args) {
      mocks.keyExtractorCalls.push(args);
      return mocks.keyExtractorResult;
    }
  }
}));

import { KeyEssentiaKeyExtractorDetector } from './essentia-key-extractor-detector.js';
import { MODES } from '../../utils/notes.js';

describe('KeyEssentiaKeyExtractorDetector', () => {
  let detector;

  beforeEach(() => {
    mocks.keyExtractorCalls.length = 0;
    mocks.keyExtractorResult = { key: 'D', scale: 'major', strength: 0.8 };
    detector = new KeyEssentiaKeyExtractorDetector();
  });

  it('initializes and resets rolling audio state', async () => {
    await detector.init(48000, 4096);
    expect(detector.sampleRate).toBe(48000);
    expect(detector.maxHistorySamples).toBe(48000 * 4);
    expect(detector.essentia).toBeDefined();
  });

  it('maps KeyExtractor major/minor scales to the app modes', async () => {
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    const detection = detector.process(new Float32Array(8192).fill(0.1));

    expect(detection).toMatchObject({ tonic: 'D', mode: MODES.MAJOR });
    expect(mocks.keyExtractorCalls).toHaveLength(1);
  });

  it('normalizes enharmonic tonics and minor scale', async () => {
    mocks.keyExtractorResult = { key: 'Eb', scale: 'minor', strength: 0.6 };
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    const detection = detector.process(new Float32Array(8192).fill(0.1));

    expect(detection).toMatchObject({ tonic: 'D#', mode: MODES.MINOR });
  });

  it('keeps only the configured rolling analysis window', async () => {
    await detector.init(10, 4);

    detector.addToHistory(new Float32Array(30).fill(0.1));
    detector.addToHistory(new Float32Array(50).fill(0.2));

    expect(detector.historySampleCount).toBe(40);
  });

  it('destroy clears resources', async () => {
    await detector.init(44100, 4096);
    detector.addToHistory(new Float32Array(1024));

    detector.destroy();

    expect(detector.essentia).toBeNull();
    expect(detector.historySampleCount).toBe(0);
  });
});
