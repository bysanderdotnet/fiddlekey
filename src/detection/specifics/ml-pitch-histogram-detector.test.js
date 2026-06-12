import { describe, expect, it } from 'vitest';
import {
  AutocorrelationPitchTracker,
  BROWSER_PITCH_TRACKER_CANDIDATES,
  MLPitchHistogramDetector,
  estimatePitchByAutocorrelation
} from './ml-pitch-histogram-detector.js';
import { MODES } from '../../utils/notes.js';

function renderMelody(frequencies, sampleRate, samplesPerNote) {
  const pcm = new Float32Array(frequencies.length * samplesPerNote);

  for (let note = 0; note < frequencies.length; note++) {
    for (let sample = 0; sample < samplesPerNote; sample++) {
      const envelope = Math.min(1, sample / 128, (samplesPerNote - sample) / 128);
      pcm[(note * samplesPerNote) + sample] = Math.sin((2 * Math.PI * frequencies[note] * sample) / sampleRate) * 0.5 * envelope;
    }
  }

  return pcm;
}

describe('MLPitchHistogramDetector', () => {
  it('documents browser-compatible CREPE/SPICE tracker options', () => {
    expect(BROWSER_PITCH_TRACKER_CANDIDATES.map(candidate => candidate.family)).toContain('CREPE');
    expect(BROWSER_PITCH_TRACKER_CANDIDATES.map(candidate => candidate.family)).toContain('SPICE');
  });

  it('estimates dominant monophonic pitch without accumulating overtone energy', () => {
    const estimate = estimatePitchByAutocorrelation(renderMelody([440], 44100, 2048), 44100, {
      minFrequency: 180,
      maxFrequency: 3500
    });

    expect(estimate.frequency).toBeGreaterThan(438);
    expect(estimate.frequency).toBeLessThan(442);
    expect(estimate.confidence).toBeGreaterThan(0.95);
  });

  it('accepts injectable ML pitch trackers and builds a pitch-class histogram', async () => {
    const detector = new MLPitchHistogramDetector({
      pitchTracker: {
        id: 'test-crepe-wrapper',
        init: async () => {},
        estimatePitch: () => ({ frequency: 293.66, confidence: 0.97 })
      },
      frameSize: 2048,
      hopSize: 1024
    });
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    const detection = detector.process(new Float32Array(4096).fill(0.2));

    expect(detection.chroma[2]).toBe(1);
    expect(detection.pitchHistogram).toMatchObject({ tracker: 'test-crepe-wrapper' });
  });

  it('detects a C major melody from dominant pitch classes', async () => {
    const detector = new MLPitchHistogramDetector({ frameSize: 2048, hopSize: 1024 });
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    const detection = detector.process(renderMelody([261.63, 329.63, 392, 523.25, 392, 329.63, 261.63], 44100, 4096));

    expect(detection).toMatchObject({ tonic: 'C', mode: MODES.MAJOR });
    expect(detection.chroma).toHaveLength(12);
    expect(detection.pitchHistogram.frames).toBeGreaterThan(0);
  });

  it('initializes the default autocorrelation tracker for benchmark-safe operation', async () => {
    const tracker = new AutocorrelationPitchTracker();
    await tracker.init({ sampleRate: 48000, frameSize: 2048, minFrequency: 180, maxFrequency: 3500 });

    expect(tracker.id).toBe('normalized-autocorrelation-fallback');
    expect(tracker.sampleRate).toBe(48000);
  });
});
