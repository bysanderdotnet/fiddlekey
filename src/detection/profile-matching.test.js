import { describe, it, expect } from 'vitest';
import { detectKey, scoreKeyCandidates, rotate } from './profile-matching.js';
import { MODES, NOTE_NAMES } from '../utils/notes.js';

// Builds a synthetic chroma vector emphasizing the notes of a scale.
function chromaFor(tonic, intervals, tonicWeight = 1.0, scaleWeight = 0.6) {
  const chroma = new Array(12).fill(0.05);
  const tonicIndex = NOTE_NAMES.indexOf(tonic);
  for (const interval of intervals) {
    chroma[(tonicIndex + interval) % 12] = scaleWeight;
  }
  chroma[tonicIndex] = tonicWeight;
  return chroma;
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

describe('rotate', () => {
  it('rotates right by n', () => {
    expect(rotate([1, 2, 3, 4], 1)).toEqual([4, 1, 2, 3]);
  });

  it('wraps around the full length', () => {
    expect(rotate([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });
});

describe('detectKey', () => {
  it('returns null for invalid chroma', () => {
    expect(detectKey(null)).toBeNull();
    expect(detectKey([1, 2, 3])).toBeNull();
  });

  it.each(['C', 'D', 'G', 'A'])('detects %s major', (tonic) => {
    const result = detectKey(chromaFor(tonic, MAJOR_INTERVALS));
    expect(result.tonic).toBe(tonic);
    expect(result.mode).toBe(MODES.MAJOR);
  });

  it.each(['A', 'E', 'B', 'D'])('detects %s minor', (tonic) => {
    const result = detectKey(chromaFor(tonic, MINOR_INTERVALS));
    expect(result.tonic).toBe(tonic);
    expect(result.mode).toBe(MODES.MINOR);
  });

  it('only ever returns major or minor', () => {
    const result = detectKey(chromaFor('F#', MAJOR_INTERVALS));
    expect([MODES.MAJOR, MODES.MINOR]).toContain(result.mode);
  });

  it('reports confidence between 0 and 1 plus an alternate', () => {
    const result = detectKey(chromaFor('D', MAJOR_INTERVALS));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.alternate).toHaveProperty('tonic');
    expect(result.alternate).toHaveProperty('mode');
  });
});

describe('scoreKeyCandidates', () => {
  it('scores all 24 tonic/mode candidates', () => {
    const results = scoreKeyCandidates(chromaFor('G', MAJOR_INTERVALS));
    expect(results).toHaveLength(24);
    expect(results[0].score).toBeGreaterThanOrEqual(results[23].score);
  });

  it('boosts common session keys over the raw score', () => {
    const results = scoreKeyCandidates(chromaFor('D', MAJOR_INTERVALS));
    const dMajor = results.find(r => r.tonicName === 'D' && r.mode === MODES.MAJOR);
    expect(dMajor.score).toBeGreaterThan(dMajor.rawScore);
  });
});
