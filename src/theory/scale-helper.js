import { Scale, Note } from "@tonaljs/tonal";
import { MODES } from "../utils/notes.js";

/**
 * Returns the 7-note scale for a given tonic and mode.
 * @param {string} tonic - The tonic of the scale (e.g., "D")
 * @param {string} mode - "major" or "minor"
 * @returns {string[]} An array of note names.
 */
export function getScaleNotes(tonic, mode) {
  const scale = Scale.get(`${tonic} ${mode.toLowerCase()}`);
  return scale.notes;
}

/**
 * Returns the 5 "safe" pentatonic notes for a given tonic and mode.
 * @param {string} tonic - The tonic of the scale
 * @param {string} mode - "major" or "minor"
 * @returns {string[]} An array of 5 note names.
 */
export function getPentatonicNotes(tonic, mode) {
  const pentatonicType = mode.toLowerCase() === MODES.MINOR
    ? "minor pentatonic"
    : "major pentatonic";
  const scale = Scale.get(`${tonic} ${pentatonicType}`);
  return scale.notes;
}

/**
 * Returns all instances of a note (with octaves) that fall within
 * the first-position violin range (G3 to A5).
 * @param {string} noteName - The name of the note (e.g., "D")
 * @returns {string[]} An array of note names with octaves (e.g., ["D4", "D5"])
 */
export function getNoteOctaves(noteName) {
  const minMidi = Note.midi("G3");
  const maxMidi = Note.midi("A5");
  const result = [];

  for (let octave = 2; octave <= 6; octave++) {
    const noteWithOctave = noteName + octave;
    const midi = Note.midi(noteWithOctave);
    if (midi !== null && midi >= minMidi && midi <= maxMidi) {
      result.push(noteWithOctave);
    }
  }
  return result;
}
