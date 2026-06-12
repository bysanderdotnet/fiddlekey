/**
 * OnnxCnnDetector
 *
 * Key detection with ONNX Runtime Web. It keeps a rolling five-second PCM
 * buffer, converts each FFT frame into a violin-range pitch-class profile,
 * stacks those PCP frames as a compact chromagram, and reduces the chromagram
 * to a normalized 12-bin model input. The ONNX model is a tiny generated 2D
 * convolutional classifier: each convolution kernel represents one tonic/mode
 * profile (24 major/minor classes), so running the model is equivalent to
 * applying profile-shaped CNN filters and a Softmax over the internal key
 * classes. The probability distribution is parsed back into tonic/mode objects
 * and smoothed before being emitted, while the averaged chroma remains
 * attached for UI, ensemble, and benchmark consumers.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import { configureOnnxRuntime } from '../onnx-runtime.js';
import { PROFILES, rotate } from '../profile-matching.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { MODES, NOTE_NAMES } from '../../utils/notes.js';
import { getFloatFrequencyDataFromPcm, frequencyToPitchClass } from './webaudio-pcp-detector.js';

const ANALYSIS_WINDOW_SECONDS = 5;
const EMIT_INTERVAL_MS = 500;
const FFT_SIZE = 8192;
const HOP_SIZE = 2048;
const MIN_FREQUENCY = 180;
const MAX_FREQUENCY = 3500;
const HARMONIC_COUNT = 4;
const MODEL_INPUT_NAME = 'chroma';
const MODEL_OUTPUT_NAME = 'probabilities';
const KEY_MODES = [MODES.MAJOR, MODES.MINOR];
const MODEL_OPSET_VERSION = 13;
const MODEL_IR_VERSION = 7;

export class OnnxCnnDetector extends KeyDetector {
  constructor(options = {}) {
    super();
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.analysisWindowSeconds = options.analysisWindowSeconds ?? ANALYSIS_WINDOW_SECONDS;
    this.fftSize = options.fftSize ?? FFT_SIZE;
    this.hopSize = options.hopSize ?? HOP_SIZE;
    this.minFrequency = options.minFrequency ?? MIN_FREQUENCY;
    this.maxFrequency = options.maxFrequency ?? MAX_FREQUENCY;
    this.harmonicCount = options.harmonicCount ?? HARMONIC_COUNT;
    this.sessionFactory = options.sessionFactory ?? null;
    this.session = null;
    this.ort = null;
    this.keyClasses = buildKeyClasses();
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.maxHistorySamples = Math.ceil(this.analysisWindowSeconds * this.sampleRate);
    this.lastSendTime = 0;
    this.pending = false;
    this.latestResult = null;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistorySamples = Math.ceil(this.analysisWindowSeconds * this.sampleRate);
    this.resetHistory();

    this.ort = configureOnnxRuntime();
    const modelBytes = buildOnnxCnnModel(this.keyClasses);

    if (this.sessionFactory) {
      this.session = await this.sessionFactory(modelBytes, this.ort);
    } else {
      this.session = await this.ort.InferenceSession.create(modelBytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    }
  }

  process(pcmChunk) {
    if (!this.session || !(pcmChunk instanceof Float32Array) || pcmChunk.length === 0) return null;

    this.addToHistory(pcmChunk);
    if (this.historySampleCount < this.fftSize) return null;

    const now = Date.now();
    if (now - this.lastSendTime <= EMIT_INTERVAL_MS) return this.consumeLatestResult();
    this.lastSendTime = now;

    const chromagram = this.extractChromagram(this.getHistoryAudio());
    const averagedChroma = getAveragedChroma(chromagram);
    if (!averagedChroma || this.pending) return this.consumeLatestResult();

    this.pending = true;
    this.runModel(averagedChroma).finally(() => {
      this.pending = false;
    });

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

  extractChromagram(audio) {
    const chromagram = [];

    for (let offset = 0; offset + this.fftSize <= audio.length; offset += this.hopSize) {
      const frame = audio.subarray(offset, offset + this.fftSize);
      const frequencyData = getFloatFrequencyDataFromPcm(frame, this.fftSize);
      const pcp = this.frequencyDataToPcp(frequencyData);
      if (pcp.some(value => value > 0)) chromagram.push(pcp);
    }

    return chromagram;
  }

  frequencyDataToPcp(frequencyData) {
    const pcp = new Array(12).fill(0);
    const nyquistBinCount = frequencyData.length;
    const binHz = this.sampleRate / (nyquistBinCount * 2);

    for (let bin = 1; bin < nyquistBinCount; bin++) {
      const frequency = bin * binHz;
      if (frequency > this.maxFrequency * this.harmonicCount) break;

      const magnitude = dbToLinearMagnitude(frequencyData[bin]);
      if (magnitude <= 0) continue;

      for (let harmonic = 1; harmonic <= this.harmonicCount; harmonic++) {
        const fundamental = frequency / harmonic;
        if (fundamental < this.minFrequency || fundamental > this.maxFrequency) continue;
        pcp[frequencyToPitchClass(fundamental)] += magnitude / harmonic;
      }
    }

    return normalizeUnitMax(pcp);
  }

  async runModel(chroma) {
    const input = new this.ort.Tensor('float32', Float32Array.from(normalizeUnitSum(chroma)), [1, 1, 12, 1]);
    const outputs = await this.session.run({ [MODEL_INPUT_NAME]: input });
    const probabilities = Array.from(outputs[MODEL_OUTPUT_NAME]?.data ?? outputs[Object.keys(outputs)[0]]?.data ?? []);
    if (probabilities.length === 0) return null;

    const ranked = probabilities
      .map((probability, index) => ({ ...this.keyClasses[index], probability }))
      .sort((a, b) => b.probability - a.probability);

    const top = ranked[0];
    const alternate = ranked[1] ?? top;
    const confidence = top.probability > 0
      ? Math.max(0, Math.min(1, ((top.probability - alternate.probability) / top.probability) * 5))
      : 0;

    const rawDetection = {
      tonic: NOTE_NAMES[top.tonic],
      mode: top.mode,
      score: top.probability,
      confidence,
      alternate: {
        tonic: NOTE_NAMES[alternate.tonic],
        mode: alternate.mode,
        score: alternate.probability
      },
      chroma,
      onnx: {
        model: 'generated-profile-cnn',
        classes: this.keyClasses.length,
        ranked: ranked.slice(0, 5).map(candidate => ({
          tonic: NOTE_NAMES[candidate.tonic],
          mode: candidate.mode,
          probability: candidate.probability
        }))
      }
    };

    const smoothed = this.smoother.add(rawDetection);
    if (smoothed) {
      smoothed.chroma = chroma;
      smoothed.onnx = rawDetection.onnx;
      this.latestResult = smoothed;
    }

    return smoothed;
  }

  consumeLatestResult() {
    const result = this.latestResult;
    this.latestResult = null;
    return result;
  }
}

export function buildKeyClasses() {
  const classes = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of KEY_MODES) {
      classes.push({ tonic, mode });
    }
  }
  return classes;
}

export function buildOnnxCnnModel(keyClasses = buildKeyClasses()) {
  const weights = buildConvolutionWeights(keyClasses);
  const bias = new Float32Array(keyClasses.length).fill(0);
  const reshapeShape = BigInt64Array.from([1n, BigInt(keyClasses.length)]);

  const graph = message([
    field(1, node('ProfileConv', 'Conv', [MODEL_INPUT_NAME, 'profile_weights', 'profile_bias'], ['logits4d'])),
    field(1, node('FlattenLogits', 'Reshape', ['logits4d', 'flat_shape'], ['logits'])),
    field(1, node('KeySoftmax', 'Softmax', ['logits'], [MODEL_OUTPUT_NAME], [attrInt('axis', 1)])),
    field(2, stringBytes('FiddlekeyGeneratedProfileCnn')),
    field(5, tensorFloat('profile_weights', [keyClasses.length, 1, 12, 1], weights)),
    field(5, tensorFloat('profile_bias', [keyClasses.length], bias)),
    field(5, tensorInt64('flat_shape', [2], reshapeShape)),
    field(11, valueInfo(MODEL_INPUT_NAME, [1, 1, 12, 1])),
    field(12, valueInfo(MODEL_OUTPUT_NAME, [1, keyClasses.length]))
  ]);

  return message([
    field(1, varint(MODEL_IR_VERSION)),
    field(7, graph),
    field(8, message([field(2, varint(MODEL_OPSET_VERSION))]))
  ]);
}

function buildConvolutionWeights(keyClasses) {
  const profiles = PROFILES;
  const data = new Float32Array(keyClasses.length * 12);

  keyClasses.forEach((keyClass, classIndex) => {
    const normalizedProfile = normalizeZScore(rotate(profiles[keyClass.mode], keyClass.tonic));
    data.set(normalizedProfile, classIndex * 12);
  });

  return data;
}

function node(name, opType, inputs, outputs, attributes = []) {
  return message([
    ...inputs.map(input => field(1, stringBytes(input))),
    ...outputs.map(output => field(2, stringBytes(output))),
    field(3, stringBytes(name)),
    field(4, stringBytes(opType)),
    ...attributes.map(attribute => field(5, attribute))
  ]);
}

function attrInt(name, value) {
  return message([
    field(1, stringBytes(name)),
    field(3, varint(value)),
    field(20, varint(2))
  ]);
}

function tensorFloat(name, dims, values) {
  return message([
    ...dims.map(dim => field(1, varint(dim))),
    field(2, varint(1)),
    ...Array.from(values).map(value => field(4, float32(value))),
    field(8, stringBytes(name))
  ]);
}

function tensorInt64(name, dims, values) {
  return message([
    ...dims.map(dim => field(1, varint(dim))),
    field(2, varint(7)),
    ...Array.from(values).map(value => field(7, varint(value))),
    field(8, stringBytes(name))
  ]);
}

function valueInfo(name, dims) {
  return message([
    field(1, stringBytes(name)),
    field(2, message([
      field(1, message([
        field(1, varint(1)),
        field(2, message(dims.map(dim => field(1, message([field(1, varint(dim))])))))
      ]))
    ]))
  ]);
}

function field(number, payload, wireType = payload.wireType ?? 2) {
  if (wireType === 2) {
    return concat([varint((number << 3) | 2), varint(payload.length), payload]);
  }
  return concat([varint((number << 3) | wireType), payload]);
}

function message(fields) {
  return concat(fields);
}

function stringBytes(value) {
  return new TextEncoder().encode(value);
}

function float32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function varint(value) {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  const bytes = [];

  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0n);

  const out = Uint8Array.from(bytes);
  out.wireType = 0;
  return out;
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function dbToLinearMagnitude(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.pow(10, value / 20);
}

function normalizeUnitMax(values) {
  const sanitized = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const max = Math.max(...sanitized);
  if (max <= 0) return sanitized;
  return sanitized.map(value => value / max);
}

function normalizeUnitSum(values) {
  const sanitized = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const sum = sanitized.reduce((total, value) => total + value, 0);
  if (sum <= 0) return sanitized;
  return sanitized.map(value => value / sum);
}

function normalizeZScore(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map(value => value - mean);
  const norm = Math.hypot(...centered);
  if (norm <= 0) return centered;
  return centered.map(value => value / norm);
}
