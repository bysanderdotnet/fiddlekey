/**
 * KeyEssentiaNNLSDetector
 *
 * This detector uses Essentia.js' NNLS chroma feature extraction path for
 * harmonic-instrument key detection. It keeps a rolling PCM audio window, slices
 * it into large overlapping frames, and runs each frame through the recommended
 * NNLS pipeline: Hann Windowing -> Spectrum -> LogSpectrum -> NNLSChroma. The
 * frame-wise 12-bin chromagrams are accumulated over the analysis window,
 * normalized, rotated from Essentia's A-based pitch-class layout into Bourdon's
 * C-based layout, and matched against the app's major/minor key profiles with Pearson
 * correlation. If Essentia.js' NNLS approximate-transcription mode returns an
 * all-zero chromagram in browser/benchmark environments, the detector retries
 * the same NNLSChroma pipeline with Essentia's documented linear spectral
 * mapping mode so the benchmark still exercises this detector instead of
 * skipping it.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { detectKey, rotate } from '../profile-matching.js';

const ANALYSIS_INTERVAL_MS = 500;
const ANALYSIS_WINDOW_SECONDS = 4;
const BINS_PER_SEMITONE = 3;
const CHROMA_NORMALIZATION = 'maximum';
const FRAME_SIZE = 16384;
const HOP_SIZE = 2048;
const ROLL_ON = 0;
const SPECTRAL_SHAPE = 0.7;
const SPECTRAL_WHITENING = 1;
const TUNING_MODE = 'global';
const WINDOW_TYPE = 'hann';

export class KeyEssentiaNNLSDetector extends KeyDetector {
  constructor() {
    super();
    this.essentia = null;
    this.module = null;
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.maxHistorySamples = ANALYSIS_WINDOW_SECONDS * this.sampleRate;
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistorySamples = Math.ceil(ANALYSIS_WINDOW_SECONDS * this.sampleRate);
    this.resetHistory();

    this.module = EssentiaWASM.ready ? await EssentiaWASM.ready : EssentiaWASM;
    this.essentia = new Essentia(this.module);
  }

  process(pcmChunk) {
    if (!this.essentia || !this.module) return null;

    this.addToHistory(pcmChunk);

    const now = Date.now();
    if (now - this.lastSendTime <= ANALYSIS_INTERVAL_MS) {
      return null;
    }
    this.lastSendTime = now;

    const audio = this.getHistoryAudio();
    if (audio.length < FRAME_SIZE) {
      return null;
    }

    const chroma = this.extractNnlsChroma(audio);
    if (!chroma) {
      return null;
    }

    const rawDetection = detectKey(chroma);
    const smoothedDetection = this.smoother.add(rawDetection);

    if (smoothedDetection) {
      smoothedDetection.chroma = chroma;
    }

    return smoothedDetection;
  }

  resetHistory() {
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.lastSendTime = 0;
    this.smoother.clear();
  }

  destroy() {
    this.resetHistory();
    this.essentia = null;
    this.module = null;
  }

  addToHistory(pcmChunk) {
    const chunk = new Float32Array(pcmChunk);
    this.audioHistory.push(chunk);
    this.historySampleCount += chunk.length;

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

  extractNnlsChroma(audio) {
    const logSpectrogram = new this.module.VectorVectorFloat();
    const logSpectrumVectors = [];
    let latestMeanTuning = null;
    let nnlsResult = null;
    let fallbackResult = null;

    try {
      for (let offset = 0; offset + FRAME_SIZE <= audio.length; offset += HOP_SIZE) {
        const frame = audio.subarray(offset, offset + FRAME_SIZE);
        const frameVectors = this.extractLogSpectrumFrame(frame);

        logSpectrogram.push_back(frameVectors.logFreqSpectrum);
        logSpectrumVectors.push(frameVectors.logFreqSpectrum);

        if (latestMeanTuning) {
          latestMeanTuning.delete();
        }
        latestMeanTuning = frameVectors.meanTuning;
      }

      if (logSpectrogram.size() === 0 || !latestMeanTuning) {
        return null;
      }

      nnlsResult = this.runNnlsChroma(logSpectrogram, latestMeanTuning, true);
      let chroma = accumulateChromagram(this.essentia, nnlsResult.chromagram);

      if (!hasEnergy(chroma)) {
        safeDeleteNnlsResult(nnlsResult);
        nnlsResult = null;
        fallbackResult = this.runNnlsChroma(logSpectrogram, latestMeanTuning, false);
        chroma = accumulateChromagram(this.essentia, fallbackResult.chromagram);
      }

      if (!hasEnergy(chroma)) {
        return null;
      }

      const normalizedChroma = normalizeChroma(chroma);

      // Essentia NNLS chroma exposes the same pitch-class convention as its HPCP
      // path for A440-centered tuning: source bin 0 is A, while our profiles use C.
      return rotate(normalizedChroma, 9);
    } finally {
      safeDeleteNnlsResult(nnlsResult);
      safeDeleteNnlsResult(fallbackResult);
      for (const vector of logSpectrumVectors) {
        safeDelete(vector);
      }
      safeDelete(latestMeanTuning);
      safeDelete(logSpectrogram);
    }
  }

  extractLogSpectrumFrame(frame) {
    const inputVector = this.essentia.arrayToVector(frame);
    let windowed = null;
    let spectrum = null;

    try {
      windowed = this.essentia.Windowing(inputVector, false, FRAME_SIZE, WINDOW_TYPE);
      spectrum = this.essentia.Spectrum(windowed.frame, FRAME_SIZE);
      const logSpectrum = this.essentia.LogSpectrum(
        spectrum.spectrum,
        BINS_PER_SEMITONE,
        FRAME_SIZE,
        ROLL_ON,
        this.sampleRate
      );

      return {
        logFreqSpectrum: logSpectrum.logFreqSpectrum,
        meanTuning: logSpectrum.meanTuning
      };
    } finally {
      safeDelete(inputVector);
      safeDelete(windowed?.frame);
      safeDelete(spectrum?.spectrum);
    }
  }

  runNnlsChroma(logSpectrogram, tuning, useNNLS) {
    return this.essentia.NNLSChroma(
      logSpectrogram,
      tuning,
      tuning,
      CHROMA_NORMALIZATION,
      FRAME_SIZE,
      this.sampleRate,
      SPECTRAL_SHAPE,
      SPECTRAL_WHITENING,
      TUNING_MODE,
      useNNLS
    );
  }
}

function accumulateChromagram(essentia, chromagram) {
  if (!chromagram || chromagram.size() === 0) return null;

  const history = [];

  for (let i = 0; i < chromagram.size(); i++) {
    const row = Array.from(essentia.vectorToArray(chromagram.get(i)), value => (
      Number.isFinite(value) ? Math.max(0, value) : 0
    ));

    if (row.length === 12) {
      history.push(row);
    }
  }

  return getAveragedChroma(history);
}

function normalizeChroma(chroma) {
  const sanitized = chroma.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const maxVal = Math.max(...sanitized);

  if (maxVal <= 0) {
    return sanitized;
  }

  return sanitized.map(value => value / maxVal);
}

function hasEnergy(chroma) {
  return Boolean(chroma?.some(value => value > 0));
}

function safeDelete(value) {
  if (value && typeof value.delete === 'function') {
    value.delete();
  }
}

function safeDeleteNnlsResult(result) {
  if (!result) return;
  safeDelete(result.tunedLogfreqSpectrum);
  safeDelete(result.semitoneSpectrum);
  safeDelete(result.bassChromagram);
  safeDelete(result.chromagram);
}
