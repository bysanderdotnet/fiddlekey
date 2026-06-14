/**
 * src/detection/note-safety-aggregator.js
 *
 * Adapts existing detector output to computeNoteSafety(). The UI should call
 * detectionToNoteSafety() once per detection result and render the note-safety
 * result — never read tonic/mode directly.
 *
 * Supports detectors that already expose a ranked `candidates` array AND old
 * detectors that only emit `{ tonic, mode, alternate }`, so the UI can migrate
 * before every detector is updated (IMPLEMENTATION.md Phase 1/2).
 */
import { computeNoteSafety, DEFAULT_NOTE_SAFETY_OPTIONS } from '../theory/note-safety.js';

export { DEFAULT_NOTE_SAFETY_OPTIONS };

/**
 * Extract candidate list from a detection result, falling back to the legacy
 * single-key (+ alternate) shape.
 * @param {Object} detection
 * @returns {Array<{tonic:string, mode?:string, score?:number}>}
 */
export function getCandidatesFromDetection(detection) {
  if (Array.isArray(detection.candidates) && detection.candidates.length) {
    return detection.candidates;
  }

  const fallback = [];

  if (detection.tonic) {
    fallback.push({
      tonic: detection.tonic,
      mode: detection.mode,
      score: detection.score ?? detection.confidence ?? 1
    });
  }

  if (detection.alternate?.tonic) {
    fallback.push({
      tonic: detection.alternate.tonic,
      mode: detection.alternate.mode ?? detection.mode,
      score: detection.alternate.score ?? 0.5
    });
  }

  return fallback;
}

/**
 * Convert a detector result into a note-safety result.
 * @param {Object|null} detection
 * @returns {Object|null} note-safety result, or null when there is no detection
 */
export function detectionToNoteSafety(detection) {
  if (!detection) return null;

  const candidates = getCandidatesFromDetection(detection);

  const result = computeNoteSafety({
    candidates,
    observedChroma: detection.chroma,
    options: DEFAULT_NOTE_SAFETY_OPTIONS
  });

  if (result && result.debug) result.debug.rawDetection = detection;
  return result;
}
