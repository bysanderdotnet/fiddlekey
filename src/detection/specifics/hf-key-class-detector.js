/**
 * HFKeyClassDetector / HFKeyClassNonQuantizedDetector
 *
 * Integrates the jcarbonnell/key_class_detection model from HuggingFace, a CNN
 * trained on log-mel spectrograms to classify audio into one of 12 pitch classes
 * (C through B). The detector keeps a five-second rolling PCM buffer, computes a
 * 272-bin log-mel spectrogram with a 250-sample hop at 44 100 Hz, and feeds the
 * resulting 272×880 spectrogram replicated to three channels into an ONNX model.
 * The model's softmax output selects the tonic pitch class; the accompanying
 * mode (major or minor) is resolved by Pearson-correlating a PCP-based chroma
 * vector against the shared major/minor profiles rotated to the
 * model-predicted tonic. Results are smoothed with a five-frame majority-vote
 * window before being emitted every 500 ms.
 *
 * HFKeyClassDetector uses the INT8-quantised model (115 MB).
 * HFKeyClassNonQuantizedDetector uses the full-precision float32 model (459 MB).
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { fetchArrayBufferWithProgress } from '../../utils/fetch-progress.js';
import { KeyDetector } from '../detector.js';
import { configureOnnxRuntime } from '../onnx-runtime.js';
import { scoreKeyCandidates } from '../profile-matching.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { MODES, NOTE_NAMES } from '../../utils/notes.js';
import { getFloatFrequencyDataFromPcm, frequencyToPitchClass } from './webaudio-pcp-detector.js';

const ANALYSIS_WINDOW_SECONDS = 5;
const EMIT_INTERVAL_MS = 500;
const N_FFT = 2048;
const HOP_LENGTH = 250;
const N_MELS = 272;
const TIME_FRAMES = 880;
const MIN_FREQUENCY = 180;
const MAX_FREQUENCY = 3500;
const HARMONIC_COUNT = 4;
const MODEL_PITCH_CLASSES = 12;
export const MODEL_PATH = __MODEL_BASE_URL__ + '/models/hf-key-class-int8.onnx';
export const MODEL_PATH_NONQUANTIZED = __MODEL_BASE_URL__ + '/models/hf-key-class-nonquantized.onnx';

export class HFKeyClassDetector extends KeyDetector {
  constructor(options = {}) {
    super();
    this.modelPath = options.modelPath ?? MODEL_PATH;
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.session = null;
    this.ort = null;
    this.melFilterbank = null;
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.maxHistorySamples = Math.ceil(ANALYSIS_WINDOW_SECONDS * 44100);
    this.lastSendTime = 0;
    this.pending = false;
    this.latestResult = null;
    this.smoother = new KeySmoother(5);
    this.sessionFactory = options.sessionFactory ?? null;
  }

  async init(sampleRate, bufferSize, onProgress) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistorySamples = Math.ceil(ANALYSIS_WINDOW_SECONDS * sampleRate);
    this.resetHistory();

    this.melFilterbank = buildMelFilterbank(sampleRate, N_FFT, N_MELS);
    this.ort = configureOnnxRuntime();

    if (this.sessionFactory) {
      this.session = await this.sessionFactory(this.ort);
    } else {
      const modelBytes = await fetchArrayBufferWithProgress(this.modelPath, onProgress);
      this.session = await this.ort.InferenceSession.create(modelBytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    }
  }

  process(pcmChunk) {
    if (!this.session || !(pcmChunk instanceof Float32Array) || pcmChunk.length === 0) return null;

    this.addToHistory(pcmChunk);
    if (this.historySampleCount < N_FFT) return null;

    const now = Date.now();
    if (now - this.lastSendTime <= EMIT_INTERVAL_MS) return this.consumeLatestResult();
    this.lastSendTime = now;

    if (this.pending) return this.consumeLatestResult();

    this.pending = true;
    const audio = this.getHistoryAudio();
    const chroma = this.extractChroma(audio);
    this.runModel(audio, chroma).finally(() => { this.pending = false; });

    return this.consumeLatestResult();
  }

  resetHistory() {
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.lastSendTime = 0;
    this.pending = false;
    this.latestResult = null;
    this.smoother.clear();
  }

  destroy() {
    this.resetHistory();
    this.session = null;
    this.ort = null;
    this.melFilterbank = null;
  }

  addToHistory(pcmChunk) {
    const copy = new Float32Array(pcmChunk);
    this.audioHistory.push(copy);
    this.historySampleCount += copy.length;

    while (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length > 1) {
      const removed = this.audioHistory.shift();
      this.historySampleCount -= removed.length;
    }

    if (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length === 1) {
      const onlyChunk = this.audioHistory[0];
      const keepFrom = onlyChunk.length - this.maxHistorySamples;
      this.audioHistory[0] = onlyChunk.slice(Math.max(0, keepFrom));
      this.historySampleCount = this.audioHistory[0].length;
    }
  }

  getHistoryAudio() {
    const audio = new Float32Array(this.historySampleCount);
    let offset = 0;
    for (const chunk of this.audioHistory) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  }

  extractChroma(audio) {
    const chromagram = [];
    for (let offset = 0; offset + N_FFT <= audio.length; offset += HOP_LENGTH) {
      const frame = audio.subarray(offset, offset + N_FFT);
      const frequencyData = getFloatFrequencyDataFromPcm(frame, N_FFT);
      const pcp = buildPcpFromFrequencyData(frequencyData, this.sampleRate);
      if (pcp.some(v => v > 0)) chromagram.push(pcp);
    }
    return getAveragedChroma(chromagram);
  }

  async runModel(audio, chroma) {
    const melData = this.computeMelSpectrogramData(audio);
    const input = new this.ort.Tensor('float32', melData, [1, 3, N_MELS, TIME_FRAMES]);
    const outputs = await this.session.run({ mel_spectrogram: input });
    const logits = Array.from(
      outputs.key_class_logits?.data ?? outputs[Object.keys(outputs)[0]]?.data ?? []
    );

    if (logits.length !== MODEL_PITCH_CLASSES) return null;

    const probs = softmax(logits);
    const tonicIndex = argmax(probs);

    const mode = resolveMode(chroma, tonicIndex);

    const sorted = [...probs].sort((a, b) => b - a);
    const confidence = sorted[0] > 0
      ? Math.max(0, Math.min(1, (sorted[0] - sorted[1]) / sorted[0] * 5))
      : 0;

    const altIndex = probs.reduce((best, p, i) => (i !== tonicIndex && p > probs[best] ? i : best), (tonicIndex + 1) % MODEL_PITCH_CLASSES);

    const rawDetection = {
      tonic: NOTE_NAMES[tonicIndex],
      mode,
      score: probs[tonicIndex],
      confidence,
      alternate: {
        tonic: NOTE_NAMES[altIndex],
        mode,
        score: probs[altIndex]
      },
      chroma,
      hfKeyClass: {
        model: 'jcarbonnell/key_class_detection',
        classes: MODEL_PITCH_CLASSES,
        ranked: probs
          .map((p, i) => ({ tonic: NOTE_NAMES[i], probability: p }))
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 5)
      }
    };

    const smoothed = this.smoother.add(rawDetection);
    if (smoothed) {
      smoothed.chroma = chroma;
      smoothed.hfKeyClass = rawDetection.hfKeyClass;
      this.latestResult = smoothed;
    }

    return smoothed;
  }

  computeMelSpectrogramData(audio) {
    const nBins = N_FFT / 2;

    // Compute log-mel spectrogram frames: columns are time, rows are mel bands
    const frames = [];
    for (let offset = 0; offset + N_FFT <= audio.length; offset += HOP_LENGTH) {
      const frame = audio.subarray(offset, offset + N_FFT);
      const frequencyData = getFloatFrequencyDataFromPcm(frame, N_FFT);

      // Convert dB to power: p = 10^(dB/10)
      const power = new Float32Array(nBins);
      for (let k = 0; k < nBins; k++) {
        const db = frequencyData[k];
        power[k] = Number.isFinite(db) ? Math.pow(10, db / 10) : 0;
      }

      // Apply mel filterbank
      const melPower = new Float32Array(N_MELS);
      for (let m = 0; m < N_MELS; m++) {
        let energy = 0;
        const filter = this.melFilterbank[m];
        for (let k = 0; k < nBins; k++) {
          energy += filter[k] * power[k];
        }
        melPower[m] = energy;
      }

      // Convert to log: 10 * log10(power + epsilon)
      const melLog = new Float32Array(N_MELS);
      for (let m = 0; m < N_MELS; m++) {
        melLog[m] = 10 * Math.log10(melPower[m] + 1e-10);
      }

      frames.push(melLog);
    }

    // Build [N_MELS, TIME_FRAMES] spectrogram (pad / crop time axis)
    const spectrogram = new Float32Array(N_MELS * TIME_FRAMES);
    const tFrames = Math.min(frames.length, TIME_FRAMES);
    for (let t = 0; t < tFrames; t++) {
      for (let m = 0; m < N_MELS; m++) {
        spectrogram[m * TIME_FRAMES + t] = frames[t][m];
      }
    }

    // Normalize: dB relative to global max, range [0, 1]
    let globalMax = -Infinity;
    for (let i = 0; i < spectrogram.length; i++) {
      if (spectrogram[i] > globalMax) globalMax = spectrogram[i];
    }
    if (!Number.isFinite(globalMax) || globalMax === 0) globalMax = 0;

    for (let i = 0; i < spectrogram.length; i++) {
      const shifted = spectrogram[i] - globalMax + 80;
      spectrogram[i] = Math.max(0, Math.min(1, shifted / 80));
    }

    // Replicate to 3 channels: [3, N_MELS, TIME_FRAMES] (NCHW layout)
    const channelSize = N_MELS * TIME_FRAMES;
    const output = new Float32Array(3 * channelSize);
    output.set(spectrogram, 0);
    output.set(spectrogram, channelSize);
    output.set(spectrogram, 2 * channelSize);

    return output;
  }

  consumeLatestResult() {
    const result = this.latestResult;
    this.latestResult = null;
    return result;
  }
}

export class HFKeyClassNonQuantizedDetector extends HFKeyClassDetector {
  constructor(options = {}) {
    super({ ...options, modelPath: options.modelPath ?? MODEL_PATH_NONQUANTIZED });
  }
}

function resolveMode(chroma, tonicIndex) {
  if (!chroma || chroma.length !== 12) return MODES.MAJOR;

  const candidates = scoreKeyCandidates(chroma).filter(c => c.tonic === tonicIndex);
  if (candidates.length === 0) return MODES.MAJOR;
  return candidates[0].mode;
}

function buildMelFilterbank(sampleRate, nFft, nMels, fmin = 0) {
  const nBins = nFft / 2;
  const fmax = (nBins - 1) * sampleRate / nFft;

  const melMin = hzToMel(fmin);
  const melMax = hzToMel(fmax);

  // n_mels + 2 center points linearly spaced in mel
  const melPoints = new Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
  }

  const hzPoints = melPoints.map(melToHz);
  // Map center frequencies to FFT bin indices
  const binPoints = hzPoints.map(hz => Math.min(nBins - 1, Math.floor((hz * nFft) / sampleRate)));

  const filterbank = new Array(nMels);
  for (let m = 0; m < nMels; m++) {
    const filter = new Float32Array(nBins);
    const lo = binPoints[m];
    const center = binPoints[m + 1];
    const hi = binPoints[m + 2];

    for (let k = lo; k <= center; k++) {
      const denom = center - lo;
      filter[k] = denom > 0 ? (k - lo) / denom : 1;
    }
    for (let k = center + 1; k <= hi; k++) {
      const denom = hi - center;
      filter[k] = denom > 0 ? (hi - k) / denom : 0;
    }

    // Slaney area normalization
    const bandwidth = hzPoints[m + 2] - hzPoints[m];
    if (bandwidth > 0) {
      for (let k = 0; k < nBins; k++) {
        filter[k] *= 2 / bandwidth;
      }
    }

    filterbank[m] = filter;
  }

  return filterbank;
}

function buildPcpFromFrequencyData(frequencyData, sampleRate) {
  const pcp = new Array(12).fill(0);
  const nBins = frequencyData.length;
  const binHz = sampleRate / (nBins * 2);

  for (let bin = 1; bin < nBins; bin++) {
    const frequency = bin * binHz;
    if (frequency > MAX_FREQUENCY * HARMONIC_COUNT) break;

    const db = frequencyData[bin];
    if (!Number.isFinite(db)) continue;
    const magnitude = Math.pow(10, db / 20);
    if (magnitude <= 0) continue;

    for (let harmonic = 1; harmonic <= HARMONIC_COUNT; harmonic++) {
      const fundamental = frequency / harmonic;
      if (fundamental < MIN_FREQUENCY || fundamental > MAX_FREQUENCY) continue;
      pcp[frequencyToPitchClass(fundamental)] += magnitude / harmonic;
    }
  }

  return normalizeUnitMax(pcp);
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function argmax(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function normalizeUnitMax(values) {
  const sanitized = values.map(v => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const max = Math.max(...sanitized);
  if (max <= 0) return sanitized;
  return sanitized.map(v => v / max);
}
