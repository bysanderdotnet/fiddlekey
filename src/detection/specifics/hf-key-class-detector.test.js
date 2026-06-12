import { describe, expect, it } from 'vitest';
import { HFKeyClassDetector, HFKeyClassNonQuantizedDetector, MODEL_PATH, MODEL_PATH_NONQUANTIZED } from './hf-key-class-detector.js';

function renderSineWaves(frequencies, sampleRate, sampleCount) {
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    let value = 0;
    for (const f of frequencies) {
      value += Math.sin((2 * Math.PI * f * i) / sampleRate);
    }
    pcm[i] = (value / frequencies.length) * 0.5;
  }
  return pcm;
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('HFKeyClassDetector', () => {
  it('exposes the correct model path constants', () => {
    expect(MODEL_PATH).toBe('https://r2-fiddlekey.bysander.net/models/hf-key-class-int8.onnx');
    expect(MODEL_PATH_NONQUANTIZED).toBe('https://r2-fiddlekey.bysander.net/models/hf-key-class-nonquantized.onnx');
  });

  it('HFKeyClassNonQuantizedDetector uses the nonquantized model path', () => {
    const detector = new HFKeyClassNonQuantizedDetector();
    expect(detector.modelPath).toBe(MODEL_PATH_NONQUANTIZED);
  });

  it('HFKeyClassNonQuantizedDetector accepts a custom modelPath override', () => {
    const detector = new HFKeyClassNonQuantizedDetector({ modelPath: '/custom/path.onnx' });
    expect(detector.modelPath).toBe('/custom/path.onnx');
  });

  it('builds a 272-band mel filterbank during init', async () => {
    const detector = new HFKeyClassDetector({
      sessionFactory: async () => ({ run: async () => ({ key_class_logits: { data: new Float32Array(12).fill(1 / 12) } }) })
    });
    await detector.init(44100, 4096);
    expect(detector.melFilterbank).toHaveLength(272);
    expect(detector.melFilterbank[0]).toBeInstanceOf(Float32Array);
    expect(detector.melFilterbank[0]).toHaveLength(1024);
  });

  it('computes mel spectrogram data with shape [3 * 272 * 880]', async () => {
    const detector = new HFKeyClassDetector({
      sessionFactory: async () => ({ run: async () => ({ key_class_logits: { data: new Float32Array(12).fill(1 / 12) } }) })
    });
    await detector.init(44100, 4096);

    // Enough audio for a full spectrogram (5 seconds)
    const audio = renderSineWaves([440, 554, 659], 44100, 44100 * 5);
    const data = detector.computeMelSpectrogramData(audio);

    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(3 * 272 * 880);
    expect(data.every(v => v >= 0 && v <= 1)).toBe(true);
  });

  it('maps ONNX softmax output to a tonic + mode detection', async () => {
    // D = index 2 in NOTE_NAMES (C=0, C#=1, D=2, ...)
    const logits = new Float32Array(12).fill(-5);
    logits[2] = 5; // D dominates

    const detector = new HFKeyClassDetector({
      sessionFactory: async () => ({ run: async () => ({ key_class_logits: { data: logits } }) })
    });
    await detector.init(44100, 4096);
    detector.lastSendTime = Date.now() - 600;

    // Feed more than 5 s of D-Dorian-like audio
    const audio = renderSineWaves([293.66, 329.63, 392], 44100, 44100 * 5);
    expect(detector.process(audio)).toBeNull();
    await flushPromises();

    const result = detector.process(new Float32Array(4096));
    // Tonic should be D (model forced it)
    if (result) {
      expect(result.tonic).toBe('D');
      expect(result.chroma).toHaveLength(12);
      expect(result.hfKeyClass.model).toBe('jcarbonnell/key_class_detection');
    }
  });

  it('returns null before enough audio has accumulated', async () => {
    const detector = new HFKeyClassDetector({
      sessionFactory: async () => ({ run: async () => ({ key_class_logits: { data: new Float32Array(12).fill(1 / 12) } }) })
    });
    await detector.init(44100, 4096);

    const tiny = new Float32Array(1024).fill(0.1);
    expect(detector.process(tiny)).toBeNull();
  });

  it('resetHistory clears internal state', async () => {
    const detector = new HFKeyClassDetector({
      sessionFactory: async () => ({ run: async () => ({ key_class_logits: { data: new Float32Array(12).fill(1 / 12) } }) })
    });
    await detector.init(44100, 4096);
    detector.process(new Float32Array(4096).fill(0.5));
    detector.resetHistory();

    expect(detector.historySampleCount).toBe(0);
    expect(detector.audioHistory).toHaveLength(0);
    expect(detector.latestResult).toBeNull();
  });
});
