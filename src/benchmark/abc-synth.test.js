import { describe, it, expect } from 'vitest';
import { parseAbc, synthesizeTune, keySignature } from './abc-synth.js';

const G_MAJOR = `X:2
T:G Major Reel
M:4/4
L:1/8
K:G
|: G2BG dGBG | c2ec d2dB :|`;

describe('keySignature', () => {
  it('G major -> F#', () => {
    expect(keySignature(7, 'major')).toEqual({ F: 1 });
  });

  it('E major -> 4 sharps', () => {
    expect(keySignature(4, 'major')).toEqual({ F: 1, C: 1, G: 1, D: 1 });
  });

  it('D dorian / E phrygian / F lydian / G mixolydian -> no accidentals (C major)', () => {
    expect(keySignature(2, 'dorian')).toEqual({});
    expect(keySignature(4, 'phrygian')).toEqual({});
    expect(keySignature(5, 'lydian')).toEqual({});
    expect(keySignature(7, 'mixolydian')).toEqual({});
  });

  it('B minor -> 2 sharps', () => {
    expect(keySignature(11, 'minor')).toEqual({ F: 1, C: 1 });
  });
});

describe('parseAbc', () => {
  it('parses notes, durations, and applies key signature', () => {
    const tune = parseAbc(G_MAJOR);
    expect(tune.key).toEqual({ tonicPc: 7, mode: 'major' });
    // First bar: G2 B G d G B G
    expect(tune.notes[0]).toEqual({ midi: 67, units: 2 });
    expect(tune.notes[1]).toEqual({ midi: 71, units: 1 });
    expect(tune.notes[3]).toEqual({ midi: 74, units: 1 }); // lowercase d = octave up
    expect(tune.notes).toHaveLength(13);
  });

  it('key signature sharpens F in G major', () => {
    const tune = parseAbc(`X:1\nT:t\nL:1/8\nK:G\nFf`);
    expect(tune.notes[0].midi).toBe(66); // F#4
    expect(tune.notes[1].midi).toBe(78); // F#5
  });

  it('inline accidentals override key signature; octave marks work', () => {
    const tune = parseAbc(`X:1\nT:t\nL:1/8\nK:G\n=F ^C c' D, z2`);
    expect(tune.notes.map(n => n.midi)).toEqual([65, 61, 84, 50, null]);
    expect(tune.notes[4].units).toBe(2);
  });
});

describe('synthesizeTune', () => {
  it('is deterministic: same input -> identical samples', () => {
    const a = synthesizeTune(G_MAJOR, { durationSec: 2 });
    const b = synthesizeTune(G_MAJOR, { durationSec: 2 });
    expect(a.length).toBe(2 * 44100);
    expect(a).toEqual(b);
  });

  it('produces non-silent normalized audio', () => {
    const pcm = synthesizeTune(G_MAJOR, { durationSec: 2, gain: 0.4 });
    let peak = 0;
    for (const s of pcm) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeGreaterThan(0.39);
    expect(peak).toBeLessThanOrEqual(0.41);
  });
});
