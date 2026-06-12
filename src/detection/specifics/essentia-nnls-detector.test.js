import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockVector {
    constructor(values = []) {
      this.values = Array.from(values);
      this.deleted = false;
    }

    push_back(value) {
      this.values.push(value);
    }

    get(index) {
      return this.values[index];
    }

    size() {
      return this.values.length;
    }

    delete() {
      this.deleted = true;
    }
  }

  class MockVectorVector extends MockVector {}

  const sourceChromaForCmajor = () => {
    const chroma = new Array(12).fill(0);
    chroma[3] = 1;
    chroma[7] = 0.75;
    chroma[10] = 0.8;
    return chroma;
  };

  return {
    MockVector,
    MockVectorVector,
    nnlsCalls: [],
    state: {
      nnlsRows: [sourceChromaForCmajor()],
      returnZeroForNnls: false
    },
    sourceChromaForCmajor
  };
});

vi.mock('essentia.js/dist/essentia-wasm.es.js', () => {
  return {
    EssentiaWASM: {
      VectorVectorFloat: mocks.MockVectorVector
    }
  };
});

vi.mock('essentia.js/dist/essentia.js-core.es.js', () => {
  return {
    default: class MockEssentia {
      constructor(module) {
        this.module = module;
      }

      arrayToVector(arr) {
        return new mocks.MockVector(arr);
      }

      Windowing() {
        return { frame: new mocks.MockVector([1, 2, 3]) };
      }

      Spectrum() {
        return { spectrum: new mocks.MockVector([1, 2, 3]) };
      }

      LogSpectrum() {
        return {
          logFreqSpectrum: new mocks.MockVector([0.1, 0.2, 0.3]),
          meanTuning: new mocks.MockVector([0])
        };
      }

      NNLSChroma(logSpectrogram, meanTuning, localTuning, chromaNormalization, frameSize, sampleRate, spectralShape, spectralWhitening, tuningMode, useNNLS) {
        mocks.nnlsCalls.push({
          logSpectrogram,
          meanTuning,
          localTuning,
          chromaNormalization,
          frameSize,
          sampleRate,
          spectralShape,
          spectralWhitening,
          tuningMode,
          useNNLS
        });

        const rows = useNNLS && mocks.state.returnZeroForNnls ? [new Array(12).fill(0)] : mocks.state.nnlsRows;

        return {
          tunedLogfreqSpectrum: new mocks.MockVectorVector(),
          semitoneSpectrum: new mocks.MockVectorVector(),
          bassChromagram: new mocks.MockVectorVector(),
          chromagram: new mocks.MockVectorVector(rows.map(row => new mocks.MockVector(row)))
        };
      }

      vectorToArray(vector) {
        return vector.values;
      }
    }
  };
});

import { KeyEssentiaNNLSDetector } from './essentia-nnls-detector.js';

describe('KeyEssentiaNNLSDetector', () => {
  let detector;

  beforeEach(() => {
    mocks.nnlsCalls.length = 0;
    mocks.state.nnlsRows = [mocks.sourceChromaForCmajor()];
    mocks.state.returnZeroForNnls = false;
    detector = new KeyEssentiaNNLSDetector();
  });

  it('initializes with Essentia.js and resets rolling audio state', async () => {
    await detector.init(48000, 4096);

    expect(detector.sampleRate).toBe(48000);
    expect(detector.maxHistorySamples).toBe(48000 * 4);
    expect(detector.essentia).toBeDefined();
  });

  it('runs Spectrum -> LogSpectrum -> NNLSChroma with the intended NNLS parameters', async () => {
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    const detection = detector.process(new Float32Array(16384).fill(0.1));

    expect(detection).toMatchObject({ tonic: 'C', mode: 'major' });
    expect(detection.chroma).toEqual([
      1,
      0,
      0,
      0,
      0.75,
      0,
      0,
      0.800000011920929,
      0,
      0,
      0,
      0
    ]);
    expect(mocks.nnlsCalls).toHaveLength(1);
    expect(mocks.nnlsCalls[0]).toMatchObject({
      chromaNormalization: 'maximum',
      frameSize: 16384,
      sampleRate: 44100,
      spectralShape: 0.7,
      spectralWhitening: 1,
      tuningMode: 'global',
      useNNLS: true
    });
    expect(mocks.nnlsCalls[0].logSpectrogram.size()).toBe(1);
  });

  it('retries NNLSChroma with linear spectral mapping if NNLS returns no chroma energy', async () => {
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;
    mocks.state.returnZeroForNnls = true;

    const detection = detector.process(new Float32Array(16384).fill(0.1));

    expect(detection).toMatchObject({ tonic: 'C', mode: 'major' });
    expect(mocks.nnlsCalls.map(call => call.useNNLS)).toEqual([true, false]);
  });

  it('keeps only the configured rolling analysis window', async () => {
    await detector.init(10, 4);

    detector.addToHistory(new Float32Array(30).fill(0.1));
    detector.addToHistory(new Float32Array(50).fill(0.2));

    expect(detector.historySampleCount).toBe(40);
    expect(Array.from(detector.getHistoryAudio())).toEqual(Array.from(new Float32Array(40).fill(0.2)));
  });

  it('destroy clears Essentia resources and history', async () => {
    await detector.init(44100, 4096);
    detector.addToHistory(new Float32Array(1024));

    detector.destroy();

    expect(detector.essentia).toBeNull();
    expect(detector.module).toBeNull();
    expect(detector.historySampleCount).toBe(0);
    expect(detector.audioHistory).toEqual([]);
  });
});
