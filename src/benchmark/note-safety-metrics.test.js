import { describe, it, expect } from 'vitest';
import { computeNoteSafetyMetrics, summarizeNoteSafety } from './note-safety-metrics.js';

const meta = {
  safe: ['C', 'D', 'E', 'G', 'A'],
  careful: ['F', 'B'],
  avoid: ['C#', 'D#', 'F#', 'G#', 'A#']
};

const ns = (safe, careful = [], avoid = []) => ({
  safe: safe.map(note => ({ note })),
  careful: careful.map(note => ({ note })),
  avoid
});

describe('computeNoteSafetyMetrics', () => {
  it('perfect green = precision 1, no dangerous green', () => {
    const m = computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'A'], ['F', 'B']), meta);
    expect(m.safePrecision).toBe(1);
    expect(m.dangerousGreenCount).toBe(0);
    expect(m.safeRecall).toBe(1);
    expect(m.usefulGreenCount).toBe(5);
  });

  it('green note metadata says avoid counts as dangerous green', () => {
    const m = computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'C#']), meta);
    expect(m.dangerousGreenCount).toBe(1);
    expect(m.safePrecision).toBeCloseTo(4 / 5);
  });

  it('expected safe shown only as careful still counts for recall', () => {
    const m = computeNoteSafetyMetrics(ns(['C', 'D', 'E'], ['G', 'A']), meta);
    expect(m.safeRecall).toBe(1);
    expect(m.safePrecision).toBe(1);
  });

  it('expected-safe hidden as avoid -> avoidFalseNegativeCount', () => {
    const m = computeNoteSafetyMetrics(ns(['C', 'D'], [], ['E', 'G', 'A']), meta);
    expect(m.avoidFalseNegativeCount).toBe(3);
    expect(m.safeRecall).toBeCloseTo(2 / 5);
  });

  it('empty output -> precision 0', () => {
    const m = computeNoteSafetyMetrics(ns([]), meta);
    expect(m.safePrecision).toBe(0);
    expect(m.usefulGreenCount).toBe(0);
  });

  it('ambiguous pair shown careful -> handled; shown green -> not handled', () => {
    const ambMeta = { ...meta, ambiguous: [['C', 'C#']] };
    const handled = computeNoteSafetyMetrics(ns(['D', 'E'], ['C', 'C#']), ambMeta);
    expect(handled.ambiguityHandled).toBe(1);
    const missed = computeNoteSafetyMetrics(ns(['C', 'D', 'E'], ['C#']), ambMeta);
    expect(missed.ambiguityHandled).toBe(0);
  });

  it('no ambiguous pairs -> ambiguityHandled defaults to 1', () => {
    const m = computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'A'], ['F', 'B']), meta);
    expect(m.ambiguityHandled).toBe(1);
  });

  it('null noteSafety scored as empty (does not throw)', () => {
    const m = computeNoteSafetyMetrics(null, meta);
    expect(m.safePrecision).toBe(0);
    expect(m.dangerousGreenCount).toBe(0);
  });

  it('score punishes dangerous green harder than missing a safe note', () => {
    const danger = computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'C#'], ['F', 'B']), meta);
    const conservative = computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G'], ['F', 'B', 'A']), meta);
    expect(conservative.score).toBeGreaterThan(danger.score);
  });
});

describe('summarizeNoteSafety', () => {
  it('rolls up per detector and sorts by avgScore', () => {
    const rows = [
      { detectorId: 'good', noteSafetyMetrics: computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'A'], ['F', 'B']), meta) },
      { detectorId: 'bad', noteSafetyMetrics: computeNoteSafetyMetrics(ns(['C#', 'D#', 'F#']), meta) },
      { detectorId: 'good', noteSafetyMetrics: computeNoteSafetyMetrics(ns(['C', 'D', 'E', 'G', 'A'], ['F', 'B']), meta) }
    ];
    const summary = summarizeNoteSafety(rows);
    expect(summary[0].detectorId).toBe('good');
    expect(summary[0].runs).toBe(2);
    expect(summary[0].avgSafePrecision).toBe(1);
    expect(summary.find(s => s.detectorId === 'bad').dangerousGreenTotal).toBe(3);
  });

  it('skips rows without noteSafetyMetrics', () => {
    const summary = summarizeNoteSafety([{ detectorId: 'x' }]);
    expect(summary).toHaveLength(0);
  });
});
