import { describe, expect, it, vi } from 'vitest';
import { EnsembleDetector, combineVotes } from './ensemble-detector.js';
import { MODES } from '../../utils/notes.js';

class StubDetector {
  constructor(result) {
    this.result = result;
    this.init = vi.fn();
    this.process = vi.fn(() => this.result);
    this.resetHistory = vi.fn();
    this.destroy = vi.fn();
  }
}

describe('EnsembleDetector', () => {
  it('initializes, processes, and destroys child detectors', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = new StubDetector({ tonic: 'D', mode: MODES.MAJOR, confidence: 0.8, score: 0.9 });
    const second = new StubDetector({ tonic: 'G', mode: MODES.MAJOR, confidence: 0.5, score: 0.7 });
    const detector = new EnsembleDetector({
      emitIntervalMs: 0,
      detectorConfigs: [
        { id: 'first', label: 'First', weight: 1, create: () => first },
        { id: 'second', label: 'Second', weight: 0.5, create: () => second }
      ]
    });

    await detector.init(44100, 4096);
    const result = detector.process(new Float32Array(4096));

    expect(first.init).toHaveBeenCalledWith(44100, 4096);
    expect(second.init).toHaveBeenCalledWith(44100, 4096);
    expect(first.process).toHaveBeenCalledOnce();
    expect(second.process).toHaveBeenCalledOnce();
    expect(result.tonic).toBe('D');
    expect(result.mode).toBe(MODES.MAJOR);
    expect(result.ensemble.detectorCount).toBe(2);

    detector.resetHistory();
    expect(first.resetHistory).toHaveBeenCalledOnce();
    expect(second.resetHistory).toHaveBeenCalledOnce();

    detector.destroy();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('applies the ITM repertoire prior when votes are otherwise tied', () => {
    const result = combineVotes([
      {
        weight: 1,
        chroma: null,
        candidates: [
          { tonicName: 'D', mode: MODES.MAJOR, normalizedScore: 1 },
          { tonicName: 'C', mode: MODES.MAJOR, normalizedScore: 1 }
        ]
      }
    ]);

    expect(result.tonic).toBe('D');
    expect(result.mode).toBe(MODES.MAJOR);
  });
});
