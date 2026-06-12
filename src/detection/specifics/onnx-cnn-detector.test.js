import { describe, expect, it } from 'vitest';
import { OnnxCnnDetector, buildKeyClasses, buildOnnxCnnModel } from './onnx-cnn-detector.js';
import { MODES } from '../../utils/notes.js';

function renderChord(frequencies, sampleRate, sampleCount) {
  const pcm = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    let value = 0;
    for (const frequency of frequencies) {
      value += Math.sin((2 * Math.PI * frequency * sample) / sampleRate);
    }
    pcm[sample] = (value / frequencies.length) * 0.5;
  }
  return pcm;
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('OnnxCnnDetector', () => {
  it('builds a browser-loadable ONNX CNN model for every tonic/mode class', () => {
    const classes = buildKeyClasses();
    const modelBytes = buildOnnxCnnModel(classes);

    expect(classes).toHaveLength(24);
    expect(classes[0]).toEqual({ tonic: 0, mode: MODES.MAJOR });
    expect(modelBytes).toBeInstanceOf(Uint8Array);
    expect(modelBytes.length).toBeGreaterThan(1000);
  });

  it('extracts normalized chromagram frames from five-second PCM windows', async () => {
    const detector = new OnnxCnnDetector({
      sessionFactory: async () => ({ run: async () => ({ probabilities: { data: new Float32Array(24).fill(1 / 48) } }) })
    });
    await detector.init(44100, 4096);

    const chromagram = detector.extractChromagram(renderChord([261.63, 329.63, 392], 44100, 44100));

    expect(chromagram.length).toBeGreaterThan(0);
    expect(chromagram[0]).toHaveLength(12);
    expect(Math.max(...chromagram[0])).toBe(1);
  });

  it('maps ONNX output probabilities back to Bourdon key detections', async () => {
    const dMinorIndex = buildKeyClasses().findIndex(keyClass => keyClass.tonic === 2 && keyClass.mode === MODES.MINOR);
    const probabilities = new Float32Array(24).fill(0.001);
    probabilities[dMinorIndex] = 0.9;

    const detector = new OnnxCnnDetector({
      sessionFactory: async () => ({ run: async () => ({ probabilities: { data: probabilities } }) })
    });
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    expect(detector.process(renderChord([293.66, 349.23, 440], 44100, 8192))).toBeNull();
    await flushPromises();

    const result = detector.process(renderChord([293.66, 349.23, 440], 44100, 8192));

    expect(result).toMatchObject({ tonic: 'D', mode: MODES.MINOR });
    expect(result.chroma).toHaveLength(12);
    expect(result.onnx.model).toBe('generated-profile-cnn');
  });
});
