import { describe, it, expect } from 'vitest';
import { computeNoteSafety, noteToIndex, indexToNote } from './note-safety.js';
import { NOTE_NAMES } from '../utils/notes.js';
import { detectionToNoteSafety } from '../detection/note-safety-aggregator.js';

// Collect bare note names from a safe/careful array (objects) or avoid (strings).
const names = arr => arr.map(x => (typeof x === 'string' ? x : x.note));

describe('computeNoteSafety', () => {
  // 1. D/G/Bm ambiguity produces common safe notes.
  it('produces common safe notes for D/G/Bm', () => {
    const result = computeNoteSafety({
      candidates: [
        { tonic: 'D', mode: 'major', score: 0.90 },
        { tonic: 'G', mode: 'major', score: 0.82 },
        { tonic: 'B', mode: 'minor', score: 0.78 }
      ]
    });

    expect(names(result.safe)).toContain('D');
    expect(names(result.safe)).toContain('A');
    expect(names(result.careful)).toEqual(expect.arrayContaining(['C', 'C#']));
  });

  // 2. C/C# ambiguity becomes careful, not green.
  it('marks the C / C# pair careful and flags it ambiguous, never safe', () => {
    const result = computeNoteSafety({
      candidates: [
        { tonic: 'D', mode: 'major', score: 0.90 },
        { tonic: 'G', mode: 'major', score: 0.82 },
        { tonic: 'B', mode: 'minor', score: 0.78 }
      ]
    });

    expect(names(result.careful)).toEqual(expect.arrayContaining(['C', 'C#']));
    expect(names(result.safe)).not.toContain('C');
    expect(names(result.safe)).not.toContain('C#');
    expect(result.ambiguity).toEqual(
      expect.arrayContaining([expect.objectContaining({ notes: ['C', 'C#'] })])
    );
  });

  // 3. A single confident candidate produces pentatonic notes as safe.
  it('returns the pentatonic as safe for a single confident candidate', () => {
    const result = computeNoteSafety({
      candidates: [{ tonic: 'C', mode: 'major', score: 0.90 }]
    });

    // C major pentatonic: C D E G A.
    for (const note of ['C', 'D', 'E', 'G', 'A']) {
      expect(names(result.safe)).toContain(note);
    }
    expect(result.status).toBe('stable');
  });

  // 4. Low candidate scores return uncertain.
  it('returns uncertain when the candidate score is low', () => {
    const result = computeNoteSafety({
      candidates: [{ tonic: 'C', mode: 'major', score: 0.50 }]
    });

    expect(result.status).toBe('uncertain');
    expect(result.safe.length).toBeLessThan(3);
    // Still offers cautious notes rather than nothing.
    expect(result.careful.length).toBeGreaterThan(0);
  });

  // 5. Observed chroma can raise a note from avoid to careful but not to safe.
  it('lets observed chroma raise an avoid note to careful but not to safe', () => {
    const candidates = [{ tonic: 'C', mode: 'major', score: 0.90 }];

    const withoutChroma = computeNoteSafety({ candidates });
    expect(names(withoutChroma.avoid)).toContain('B'); // major 7th: avoid on its own

    const chroma = new Array(12).fill(0);
    chroma[noteToIndex('B')] = 1.0;
    const withChroma = computeNoteSafety({ candidates, observedChroma: chroma });

    expect(names(withChroma.careful)).toContain('B');
    expect(names(withChroma.safe)).not.toContain('B'); // chroma alone can't make it green
  });

  // 6. Missing candidates returns null (aggregator) or listening state (core).
  it('returns a listening state with no candidates', () => {
    const listening = computeNoteSafety({});
    expect(listening.status).toBe('listening');
    expect(listening.safe).toEqual([]);
    expect(listening.careful).toEqual([]);
    expect(listening.avoid).toEqual([]);
    expect(listening.ambiguity).toEqual([]);

    expect(computeNoteSafety({ candidates: [] }).status).toBe('listening');
    expect(detectionToNoteSafety(null)).toBeNull();
  });

  // 7. Duplicate / enharmonic-ish inputs do not duplicate chips.
  it('does not duplicate notes for duplicate or enharmonic candidates', () => {
    const result = computeNoteSafety({
      candidates: [
        { tonic: 'D', mode: 'major', score: 0.92 },
        { tonic: 'D', mode: 'major', score: 0.88 }, // literal duplicate
        { tonic: 'Gb', mode: 'major', score: 0.80 } // flat spelling -> F#
      ]
    });

    const all = [...names(result.safe), ...names(result.careful), ...result.avoid];
    // Every pitch class appears exactly once, all canonical (sharp) spellings.
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
    expect(all.every(n => NOTE_NAMES.includes(n))).toBe(true);
    expect(all.filter(n => n === 'D')).toHaveLength(1);
  });
});

describe('note helpers', () => {
  it('maps flats and sharps to the same pitch class', () => {
    expect(noteToIndex('Gb')).toBe(noteToIndex('F#'));
    expect(noteToIndex('Bb')).toBe(noteToIndex('A#'));
    expect(indexToNote(noteToIndex('Eb'))).toBe('D#');
  });
});

describe('detectionToNoteSafety', () => {
  it('converts legacy { tonic, mode, alternate } detector output', () => {
    const result = detectionToNoteSafety({
      tonic: 'D',
      mode: 'major',
      score: 0.9,
      alternate: { tonic: 'B', mode: 'minor', score: 0.8 }
    });

    expect(result).not.toBeNull();
    expect(names(result.safe)).toContain('D');
    expect(result.debug.rawDetection.tonic).toBe('D');
  });
});
