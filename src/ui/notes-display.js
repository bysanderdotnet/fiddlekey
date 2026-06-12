/**
 * src/ui/notes-display.js
 *
 * Renders the safe notes (pentatonic and full scale) for the detected key.
 */

import { getScaleNotes, getPentatonicNotes } from '../theory/scale-helper.js';
import { NOTE_NAMES } from '../utils/notes.js';

/**
 * Updates the notes display with pentatonic and scale note chips.
 * @param {Object} detection { tonic, mode, confidence }
 */
export function updateNotesDisplay(detection) {
  const container = document.getElementById('notes-display');
  if (!container) return;

  // Clear if no detection or very low confidence
  if (!detection || detection.confidence < 0.1) {
    container.innerHTML = '';
    container.style.opacity = '0';
    return;
  }

  const { tonic, mode } = detection;
  const tonicName = typeof tonic === 'number' ? NOTE_NAMES[tonic] : tonic;

  try {
    const pentatonicNotes = getPentatonicNotes(tonicName, mode);
    const scaleNotes = getScaleNotes(tonicName, mode);

    // Additional notes are those in the scale but not in the pentatonic set
    const additionalNotes = scaleNotes.filter(n => !pentatonicNotes.includes(n));

    // Simple fade-in transition
    container.style.opacity = '1';
    container.innerHTML = '';

    // 1. Pentatonic Row (Safe notes)
    const pentaRow = document.createElement('div');
    pentaRow.className = 'notes-row pentatonic-row';

    pentatonicNotes.forEach(note => {
      const chip = createNoteChip(note, 'pentatonic', note === tonicName);
      pentaRow.appendChild(chip);
    });

    container.appendChild(pentaRow);

    // 2. Additional Scale Notes Row
    if (additionalNotes.length > 0) {
      const scaleRow = document.createElement('div');
      scaleRow.className = 'notes-row scale-row';

      additionalNotes.forEach(note => {
        const chip = createNoteChip(note, 'scale', false);
        scaleRow.appendChild(chip);
      });

      container.appendChild(scaleRow);
    }
  } catch (error) {
    console.error('Error updating notes display:', error);
  }
}

/**
 * Helper to create a note chip element.
 */
function createNoteChip(note, type, isTonic) {
  const chip = document.createElement('div');
  chip.className = `note-chip ${type}${isTonic ? ' tonic' : ''}`;
  chip.textContent = note;
  return chip;
}
