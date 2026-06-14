import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebAudioPCPDetector } from './webaudio-pcp-detector.js';
import { synthesizeTune } from '../../benchmark/abc-synth.js';

const SAMPLE_RATE = 44100;
const BUFFER = 4096;

/** Stream PCM through the detector with a deterministic fake clock so the
 *  500ms emit gate fires. Returns the last emitted detection. */
function streamThrough(detector, pcm) {
  const realNow = Date.now;
  let clock = 0;
  let last = null;
  try {
    for (let off = 0; off + BUFFER <= pcm.length; off += BUFFER) {
      clock += (BUFFER / SAMPLE_RATE) * 1000;
      Date.now = () => clock;
      const result = detector.process(pcm.subarray(off, off + BUFFER));
      if (result) last = result;
    }
  } finally {
    Date.now = realNow;
  }
  return last;
}

describe('WebAudioPCPDetector', () => {
  it('settles on the tonic, not the relative dominant, for a C major tune', async () => {
    // Regression for F-00009: harmonic self-votes over-credited the fifth, so a
    // C major tune read as G major. Damping the h=1 self-vote fixes it.
    const abc = readFileSync(new URL('../../../abc/c_major.abc', import.meta.url), 'utf8');
    const pcm = synthesizeTune(abc, { sampleRate: SAMPLE_RATE, durationSec: 15 });

    const detector = new WebAudioPCPDetector();
    await detector.init(SAMPLE_RATE, BUFFER);
    const detection = streamThrough(detector, pcm);

    expect(detection).not.toBeNull();
    expect(detection.tonic).toBe('C');
    expect(detection.mode).toBe('major');
  });

  it('attaches ranked candidates for the note-safety layer (F-00011)', async () => {
    const abc = readFileSync(new URL('../../../abc/c_major.abc', import.meta.url), 'utf8');
    const pcm = synthesizeTune(abc, { sampleRate: SAMPLE_RATE, durationSec: 15 });

    const detector = new WebAudioPCPDetector();
    await detector.init(SAMPLE_RATE, BUFFER);
    const detection = streamThrough(detector, pcm);

    expect(detection).not.toBeNull();
    expect(Array.isArray(detection.candidates)).toBe(true);
    expect(detection.candidates.length).toBeLessThanOrEqual(5);
    expect(detection.candidates[0]).toHaveProperty('tonic');
    expect(detection.candidates[0]).toHaveProperty('mode');
    expect(detection.candidates[0]).toHaveProperty('score');
  });

  it('damps the harmonic self-vote so overtone bins credit their fundamental', () => {
    // A lone partial at ~786 Hz (G, the 3rd harmonic of C). Its h=1 self-vote
    // lands on G; its h=3 fold lands on C. A smaller self-weight shifts share
    // away from the spurious G toward the true fundamental C.
    const damped = new WebAudioPCPDetector();              // default self-weight 0.3
    const undamped = new WebAudioPCPDetector({ selfHarmonicWeight: 1 });
    expect(damped.selfHarmonicWeight).toBeLessThan(1);

    const binCount = undamped.fftSize / 2;
    const binHz = SAMPLE_RATE / undamped.fftSize;
    const bin = Math.round(786 / binHz);
    const fd = new Float32Array(binCount).fill(-Infinity);
    fd[bin] = 0; // 0 dB == unit magnitude

    const dampedPcp = damped.frequencyDataToPcp(fd);
    const undampedPcp = undamped.frequencyDataToPcp(fd);

    // Pitch class 7 = G (the self-voted overtone), 0 = C (the folded fundamental).
    expect(dampedPcp[7]).toBe(1);
    expect(undampedPcp[7]).toBe(1);
    expect(dampedPcp[0]).toBeGreaterThan(undampedPcp[0]);
  });
});
