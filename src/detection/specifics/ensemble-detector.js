/**
 * EnsembleDetector
 *
 * This detector fuses several existing key detectors instead of extracting a new
 * feature type directly. It initializes the Essentia HPCP, Meyda chroma, and
 * dependency-free Web Audio PCP detectors, feeds each incoming PCM chunk through
 * all of them, and keeps each detector's most recent output. When child detectors
 * expose 12-bin chroma/PCP features, those features are rescored against the
 * shared major/minor key-profile matcher to produce complete tonic/mode score
 * vectors; otherwise the child detector's current tonic/mode result contributes
 * a focused confidence-weighted vote. The ensemble sums these weighted vectors,
 * applies a small session-repertoire prior for common fiddle keys (D/G/A major,
 * A/E minor), and smooths the winning key over time to reduce flicker.
 */
import { KeyDetector } from '../detector.js';
import { EssentiaDetector } from './essentia-detector.js';
import { MeydaDetector } from './meyda-detector.js';
import { WebAudioPCPDetector } from './webaudio-pcp-detector.js';
import { scoreKeyCandidates } from '../profile-matching.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { MODES, NOTE_NAMES } from '../../utils/notes.js';

const DEFAULT_DETECTOR_CONFIGS = [
  { id: 'essentia', label: 'Essentia.js HPCP', create: () => new EssentiaDetector(), weight: 1.15 },
  { id: 'meyda', label: 'Meyda chroma', create: () => new MeydaDetector(), weight: 0.9 },
  { id: 'webaudioPcp', label: 'Web Audio PCP', create: () => new WebAudioPCPDetector(), weight: 1 }
];

const EMIT_INTERVAL_MS = 500;
const DIRECT_RESULT_SCORE = 1;
const MIN_CONFIDENCE_WEIGHT = 0.25;
const ITM_PRIOR_BOOST = 0.08;

const ITM_PRIOR_KEYS = new Set([
  keyId('D', MODES.MAJOR),
  keyId('G', MODES.MAJOR),
  keyId('A', MODES.MAJOR),
  keyId('A', MODES.MINOR),
  keyId('E', MODES.MINOR)
]);

export class EnsembleDetector extends KeyDetector {
  constructor(options = {}) {
    super();
    this.detectorConfigs = options.detectorConfigs ?? DEFAULT_DETECTOR_CONFIGS;
    this.emitIntervalMs = options.emitIntervalMs ?? EMIT_INTERVAL_MS;
    this.detectors = [];
    this.latestVotes = new Map();
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.destroy();
    this.detectors = this.detectorConfigs.map(config => ({
      ...config,
      instance: config.create()
    }));

    await Promise.all(this.detectors.map(({ instance }) => instance.init(sampleRate, bufferSize)));
    this.latestVotes.clear();
    this.lastSendTime = 0;
    this.smoother.clear();
  }

  process(pcmChunk) {
    if (this.detectors.length === 0) return null;

    for (const config of this.detectors) {
      // A misbehaving child detector (e.g. Meyda on a bad buffer) must not abort
      // the loop — detectors after it in the list still need to run and vote.
      let result = null;
      try {
        result = config.instance.process(pcmChunk);
      } catch {
        result = null;
      }
      if (result) {
        this.latestVotes.set(config.id, buildDetectorVote(result, config.weight));
      }
    }

    const now = Date.now();
    if (now - this.lastSendTime <= this.emitIntervalMs) return null;
    this.lastSendTime = now;

    const combined = combineVotes([...this.latestVotes.values()]);
    if (!combined) return null;

    const smoothedDetection = this.smoother.add(combined);
    if (smoothedDetection) {
      smoothedDetection.chroma = combined.chroma;
      smoothedDetection.ensemble = combined.ensemble;
      // Ranked fused keys are already {tonic, mode, score}; reuse as candidates
      // for the note-safety layer (IMPLEMENTATION.md Phase 2).
      smoothedDetection.candidates = combined.ensemble.ranked.slice(0, 5);
    }

    return smoothedDetection;
  }

  resetHistory() {
    for (const { instance } of this.detectors) {
      instance.resetHistory();
    }
    this.latestVotes.clear();
    this.lastSendTime = 0;
    this.smoother.clear();
  }

  destroy() {
    for (const detector of this.detectors ?? []) {
      detector.instance.destroy();
    }
    this.detectors = [];
    this.latestVotes = new Map();
    this.lastSendTime = 0;
    this.smoother.clear();
  }
}

export function combineVotes(votes) {
  const activeVotes = votes.filter(Boolean);
  if (activeVotes.length === 0) return null;

  const combinedScores = new Map();
  let totalWeight = 0;
  const chromaAccumulator = new Array(12).fill(0);
  let chromaWeight = 0;

  for (const vote of activeVotes) {
    totalWeight += vote.weight;

    for (const candidate of vote.candidates) {
      const id = keyId(candidate.tonicName, candidate.mode);
      combinedScores.set(id, (combinedScores.get(id) ?? 0) + candidate.normalizedScore * vote.weight);
    }

    if (vote.chroma) {
      for (let i = 0; i < chromaAccumulator.length; i++) {
        chromaAccumulator[i] += vote.chroma[i] * vote.weight;
      }
      chromaWeight += vote.weight;
    }
  }

  if (combinedScores.size === 0 || totalWeight <= 0) return null;

  for (const priorKey of ITM_PRIOR_KEYS) {
    combinedScores.set(priorKey, (combinedScores.get(priorKey) ?? 0) + ITM_PRIOR_BOOST * totalWeight);
  }

  const ranked = [...combinedScores.entries()]
    .map(([id, score]) => ({ ...parseKeyId(id), score }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const alternate = ranked[1] ?? top;
  const confidence = top.score > 0
    ? Math.max(0, Math.min(1, ((top.score - alternate.score) / top.score) * 5))
    : 0;

  return {
    tonic: top.tonic,
    mode: top.mode,
    score: top.score / totalWeight,
    confidence,
    alternate: {
      tonic: alternate.tonic,
      mode: alternate.mode,
      score: alternate.score / totalWeight
    },
    chroma: chromaWeight > 0 ? chromaAccumulator.map(value => value / chromaWeight) : undefined,
    ensemble: {
      detectorCount: activeVotes.length,
      totalWeight,
      ranked: ranked.slice(0, 5).map(candidate => ({
        tonic: candidate.tonic,
        mode: candidate.mode,
        score: candidate.score / totalWeight
      }))
    }
  };
}

function buildDetectorVote(result, detectorWeight = 1) {
  const confidenceWeight = MIN_CONFIDENCE_WEIGHT + Math.max(0, Math.min(1, result.confidence ?? 0));
  const weight = detectorWeight * confidenceWeight;

  if (result.chroma?.length === 12) {
    return {
      weight,
      chroma: result.chroma,
      candidates: normalizeCandidates(scoreKeyCandidates(result.chroma))
    };
  }

  if (!result.tonic || !result.mode) return null;

  return {
    weight,
    chroma: null,
    candidates: [{
      tonicName: result.tonic,
      mode: result.mode,
      normalizedScore: DIRECT_RESULT_SCORE
    }]
  };
}

function normalizeCandidates(candidates) {
  if (candidates.length === 0) return [];

  const scores = candidates.map(candidate => candidate.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;

  return candidates.map(candidate => ({
    tonicName: candidate.tonicName ?? NOTE_NAMES[candidate.tonic],
    mode: candidate.mode,
    normalizedScore: range > 0 ? (candidate.score - minScore) / range : 0
  }));
}

function keyId(tonic, mode) {
  return `${tonic}:${mode}`;
}

function parseKeyId(id) {
  const [tonic, mode] = id.split(':');
  return { tonic, mode };
}
