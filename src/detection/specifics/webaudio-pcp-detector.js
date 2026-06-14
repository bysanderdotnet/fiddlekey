/**
 * WebAudioPCPDetector
 *
 * This detector implements a dependency-free pitch-class-profile fast path inspired by
 * Web Audio's AnalyserNode frequency snapshots. In the current worker-based audio pipeline
 * it computes the same kind of linear FFT magnitude bins directly from incoming PCM chunks,
 * which keeps it runnable in browsers, workers, tests, and the benchmark suite without an
 * AudioContext on the detector side. Magnitude bins from an FFT size between 4096 and 8192
 * are mapped into 12 pitch classes over the violin-focused 180Hz-3500Hz range, with harmonic
 * summation so upper partials reinforce their likely fundamentals. The resulting PCP vectors
 * are unit-normalized, accumulated in a rolling history, averaged for temporal smoothing, and
 * template-matched against the shared major/minor key profiles using Pearson correlation.
 *
 * Each spectral bin votes for the pitch classes of its sub-harmonics (bin/h). The h=1 vote —
 * a bin crediting its own pitch class — is the troublesome one: an overtone bin (e.g. a note's
 * strong 3rd partial, a perfect fifth above) has no way to know it isn't itself a fundamental,
 * so at full weight it over-credits the relative dominant and the detector settled a fifth high
 * (C major read as G major). SELF_HARMONIC_WEIGHT damps that self-vote so genuine fundamentals
 * — which also collect folded energy from their own overtones — win.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { detectKey, detectKeyCandidates } from '../profile-matching.js';

const MIN_FREQUENCY = 180;
const MAX_FREQUENCY = 3500;
const MIN_FFT_SIZE = 4096;
const MAX_FFT_SIZE = 8192;
const HARMONIC_COUNT = 4;
const SELF_HARMONIC_WEIGHT = 0.3;
const EMIT_INTERVAL_MS = 500;

export class WebAudioPCPDetector extends KeyDetector {
  constructor(options = {}) {
    super();
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.fftSize = options.fftSize ?? MAX_FFT_SIZE;
    this.minFrequency = options.minFrequency ?? MIN_FREQUENCY;
    this.maxFrequency = options.maxFrequency ?? MAX_FREQUENCY;
    this.harmonicCount = options.harmonicCount ?? HARMONIC_COUNT;
    this.selfHarmonicWeight = options.selfHarmonicWeight ?? SELF_HARMONIC_WEIGHT;
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.pcpHistory = [];
    this.maxPcpHistoryLength = 0;
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.fftSize = clampFftSize(this.fftSize || bufferSize);
    this.maxPcpHistoryLength = Math.ceil((2 * this.sampleRate) / this.fftSize);
    this.resetHistory();
  }

  process(pcmChunk) {
    if (!(pcmChunk instanceof Float32Array) || pcmChunk.length === 0) return null;

    this.addToHistory(pcmChunk);
    if (this.historySampleCount < this.fftSize) return null;

    const frame = this.getLatestFrame();
    const frequencyData = getFloatFrequencyDataFromPcm(frame, this.fftSize);
    const pcp = this.frequencyDataToPcp(frequencyData);

    if (pcp.some(value => value > 0)) {
      this.pcpHistory.push(pcp);
      while (this.pcpHistory.length > this.maxPcpHistoryLength) {
        this.pcpHistory.shift();
      }
    }

    const now = Date.now();
    if (now - this.lastSendTime <= EMIT_INTERVAL_MS) return null;

    this.lastSendTime = now;
    const averagedPcp = getAveragedChroma(this.pcpHistory);
    if (!averagedPcp) return null;

    const rawDetection = detectKey(averagedPcp);
    const smoothedDetection = this.smoother.add(rawDetection);

    if (smoothedDetection) {
      smoothedDetection.chroma = averagedPcp;
      smoothedDetection.candidates = detectKeyCandidates(averagedPcp).slice(0, 5);
    }

    return smoothedDetection;
  }

  /**
   * Accepts AnalyserNode-style dB bins, enabling direct use with getFloatFrequencyData()
   * if a future main-thread integration supplies frequency snapshots instead of PCM.
   * @param {Float32Array|number[]} frequencyData
   * @returns {number[]}
   */
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

        const pitchClass = frequencyToPitchClass(fundamental);
        const weight = harmonic === 1 ? this.selfHarmonicWeight : 1 / harmonic;
        pcp[pitchClass] += magnitude * weight;
      }
    }

    return normalizeUnitMax(pcp);
  }

  addToHistory(pcmChunk) {
    const copy = new Float32Array(pcmChunk);
    this.audioHistory.push(copy);
    this.historySampleCount += copy.length;

    const maxSamples = this.fftSize;
    while (this.historySampleCount > maxSamples && this.audioHistory.length > 0) {
      const first = this.audioHistory[0];
      const excess = this.historySampleCount - maxSamples;

      if (first.length <= excess) {
        this.audioHistory.shift();
        this.historySampleCount -= first.length;
      } else {
        this.audioHistory[0] = first.slice(excess);
        this.historySampleCount -= excess;
      }
    }
  }

  getLatestFrame() {
    const frame = new Float32Array(this.fftSize);
    let offset = this.fftSize - this.historySampleCount;

    for (const chunk of this.audioHistory) {
      frame.set(chunk, offset);
      offset += chunk.length;
    }

    return frame;
  }

  resetHistory() {
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.pcpHistory = [];
    this.smoother.clear();
    this.lastSendTime = 0;
  }

  destroy() {
    this.resetHistory();
  }
}

export function getFloatFrequencyDataFromPcm(pcmFrame, fftSize) {
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let i = 0; i < fftSize; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    real[i] = (pcmFrame[i] || 0) * window;
  }

  fft(real, imag);

  const frequencyData = new Float32Array(fftSize / 2);
  for (let bin = 0; bin < frequencyData.length; bin++) {
    const magnitude = Math.hypot(real[bin], imag[bin]) / (fftSize / 2);
    frequencyData[bin] = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity;
  }

  return frequencyData;
}

export function frequencyToPitchClass(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return ((midi % 12) + 12) % 12;
}

function clampFftSize(size) {
  const requested = Math.min(MAX_FFT_SIZE, Math.max(MIN_FFT_SIZE, size));
  return previousPowerOfTwo(requested);
}

function previousPowerOfTwo(value) {
  let power = 1;
  while (power * 2 <= value) power *= 2;
  return power;
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

function fft(real, imag) {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;

    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      const halfLen = len >> 1;

      for (let j = 0; j < halfLen; j++) {
        const evenIndex = i + j;
        const oddIndex = evenIndex + halfLen;
        const oddReal = real[oddIndex] * wReal - imag[oddIndex] * wImag;
        const oddImag = real[oddIndex] * wImag + imag[oddIndex] * wReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextWReal;
      }
    }
  }
}
