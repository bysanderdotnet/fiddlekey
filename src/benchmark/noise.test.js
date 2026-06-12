import { describe, it, expect } from 'vitest';
import { generateNoise, mixNoise, mulberry32, hashString } from './noise.js';

describe('noise determinism', () => {
  it('mulberry32 with same seed yields same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('hashString is stable', () => {
    expect(hashString('c_major')).toBe(hashString('c_major'));
    expect(hashString('c_major')).not.toBe(hashString('a_minor'));
  });

  it('generateNoise is reproducible per seed and differs across seeds', () => {
    const a = generateNoise('session', 44100, 44100, 7);
    const b = generateNoise('session', 44100, 44100, 7);
    const c = generateNoise('session', 44100, 44100, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('mixNoise', () => {
  const signal = new Float32Array(44100);
  for (let i = 0; i < signal.length; i++) signal[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100);

  function rms(buf) {
    let sum = 0;
    for (const s of buf) sum += s * s;
    return Math.sqrt(sum / buf.length);
  }

  it("type 'none' returns an unmodified copy", () => {
    const out = mixNoise(signal, { type: 'none' });
    expect(out).toEqual(signal);
    expect(out).not.toBe(signal);
  });

  it('hits the requested SNR', () => {
    for (const type of ['white', 'babble', 'session']) {
      const snrDb = 10;
      const out = mixNoise(signal, { type, snrDb, seed: 3 }, 44100);
      const noisePart = new Float32Array(signal.length);
      for (let i = 0; i < signal.length; i++) noisePart[i] = out[i] - signal[i];
      const measured = 20 * Math.log10(rms(signal) / rms(noisePart));
      expect(measured).toBeGreaterThan(snrDb - 0.5);
      expect(measured).toBeLessThan(snrDb + 0.5);
    }
  });

  it('is reproducible', () => {
    const a = mixNoise(signal, { type: 'session', snrDb: 6, seed: 5 }, 44100);
    const b = mixNoise(signal, { type: 'session', snrDb: 6, seed: 5 }, 44100);
    expect(a).toEqual(b);
  });
});
