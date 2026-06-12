import { describe, it, expect, beforeEach } from 'vitest';
import { MeydaDetector } from './meyda-detector';
import { MODES } from '../../utils/notes.js';

describe('MeydaDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new MeydaDetector();
  });

  it('should initialize and reset state', async () => {
    await detector.init(44100, 4096);
    expect(detector.sampleRate).toBe(44100);
    expect(detector.maxHistoryLength).toBeGreaterThan(0);
  });

  it('process() should return null initially if enough time has not passed', async () => {
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now(); // reset time so 500ms hasn't passed
    const pcm = new Float32Array(4096).fill(0.1);
    const result = detector.process(pcm);
    expect(result).toBeNull();
  });

  it('process() should eventually return a DetectionResult after enough data', async () => {
    await detector.init(44100, 4096);
    const pcm = new Float32Array(4096).fill(0);

    // Simulate time passing
    detector.lastSendTime = Date.now() - 600;

    // Generate a sine wave at 440Hz
    for (let i = 0; i < 4096; i++) {
      pcm[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
    }

    let result = null;
    for (let i = 0; i < 5; i++) {
      result = detector.process(pcm);
      if (result) break;
    }

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('tonic');
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('chroma');
    expect(result.chroma).toHaveLength(12);
  });

  it('resetHistory() should clear history and smoother', async () => {
    await detector.init(44100, 4096);
    detector.chromaHistory.push(new Array(12).fill(0));
    detector.smoother.add({ tonic: 'C', mode: MODES.MAJOR });
    detector.lastSendTime = 123456;

    detector.resetHistory();

    expect(detector.chromaHistory.length).toBe(0);
    expect(detector.smoother.history.length).toBe(0);
    expect(detector.lastSendTime).toBe(0);
  });

  it('after resetHistory(), the detector is still usable', async () => {
    await detector.init(44100, 4096);
    detector.resetHistory();
    detector.lastSendTime = Date.now() - 600;
    const pcm = new Float32Array(4096).fill(0);
    const result = detector.process(pcm);
    expect(result).not.toBeNull();
  });

  it('destroy() should clear resources', async () => {
    await detector.init(44100, 4096);
    detector.destroy();
    expect(detector.chromaHistory.length).toBe(0);
  });
});
