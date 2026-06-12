import { getScaleNotes, getPentatonicNotes, getNoteOctaves } from '../theory/scale-helper.js';
import { NOTE_NAMES } from '../utils/notes.js';
import { Note } from "@tonaljs/tonal";

const STRINGS = ['G', 'D', 'A', 'E'];
const STRING_ROOTS = [55, 62, 69, 76]; // MIDI notes for G3, D4, A4, E5


/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/**
 * Updates the SVG fingerboard with note dots.
 * @param {Object} detection { tonic, mode, confidence }
 */
export function updateFingerboard(detection) {
  const container = document.getElementById('fingerboard');
  if (!container) return;

  // Clear if no detection or very low confidence
  if (!detection || detection.confidence < 0.1) {
    container.innerHTML = '';
    return;
  }

  const { tonic, mode } = detection;
  const tonicName = typeof tonic === 'number' ? NOTE_NAMES[tonic] : tonic;

  try {
    const pentatonicNotes = getPentatonicNotes(tonicName, mode);
    const scaleNotes = getScaleNotes(tonicName, mode);

    renderFingerboard(container, pentatonicNotes, scaleNotes, tonicName);
  } catch (error) {
    console.error('Error updating fingerboard:', error);
  }
}

/**
 * Renders the SVG fingerboard.
 */
function renderFingerboard(container, pentatonic, scale, tonic) {
  const width = 300;
  const height = 500;
  const margin = { top: 40, right: 30, bottom: 20, left: 30 };

  const svgParts = [
    `
    <svg viewBox="0 0 ${width} ${height}" class="fingerboard-svg" xmlns="http://www.w3.org/2000/svg">
      <!-- Fingerboard background -->
      <rect x="${margin.left}" y="${margin.top}" width="${width - margin.left - margin.right}" height="${height - margin.top - margin.bottom}" fill="#2a2a2a" rx="10" />

      <!-- Nut -->
      <line x1="${margin.left}" y1="${margin.top}" x2="${width - margin.right}" y2="${margin.top}" stroke="#fff" stroke-width="4" />
  `
  ];

  // Draw strings
  const stringSpacing = (width - margin.left - margin.right) / 3;
  for (let i = 0; i < 4; i++) {
    const x = margin.left + i * stringSpacing;
    svgParts.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#888" stroke-width="2" />`);
    // String labels
    svgParts.push(`<text x="${x}" y="${margin.top - 15}" text-anchor="middle" fill="#aaa" font-size="14" font-weight="bold">${STRINGS[i]}</text>`);
  }

  // Draw position markers (approximate "frets" for guidance)
  const posHeight = (height - margin.top - margin.bottom) / 8;
  for (let i = 1; i <= 7; i++) {
    const y = margin.top + i * posHeight;
    svgParts.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#444" stroke-width="1" stroke-dasharray="2,2" />`);
  }

  // Map notes to fingerboard
  const notesToDisplay = [];
  scale.forEach(noteName => {
    const octaves = getNoteOctaves(noteName);
    const isPentatonic = pentatonic.includes(noteName);
    const isTonic = noteName === tonic;

    octaves.forEach(noteWithOctave => {
      const midi = Note.midi(noteWithOctave);
      if (midi === null) return;

      // Check each string
      for (let s = 0; s < 4; s++) {
        const root = STRING_ROOTS[s];
        const pos = midi - root;
        // First position usually spans 7 semitones (up to 4th finger)
        if (pos >= 0 && pos <= 7) {
          notesToDisplay.push({
            string: s,
            pos,
            name: noteName,
            isPentatonic,
            isTonic
          });
        }
      }
    });
  });

  // Render dots
  notesToDisplay.forEach(n => {
    const x = margin.left + n.string * stringSpacing;
    const y = margin.top + n.pos * posHeight;

    const color = n.isPentatonic ? 'var(--accent-color, #4caf50)' : 'var(--warn-color, #ffc107)';
    const textColor = n.isPentatonic ? '#ffffff' : '#000000';
    const radius = 14;

    // Finger number mapping
    let finger = '0';
    if (n.pos === 1 || n.pos === 2) finger = '1';
    else if (n.pos === 3 || n.pos === 4) finger = '2';
    else if (n.pos === 5 || n.pos === 6) finger = '3';
    else if (n.pos === 7) finger = '4';

    if (n.pos === 0) {
      // Open string - show a ring at the nut
      svgParts.push(`
        <g class="note-dot open-string">
          <circle cx="${x}" cy="${margin.top}" r="${radius}" fill="#121212" stroke="${color}" stroke-width="3" />
          <text x="${x}" y="${margin.top + 5}" text-anchor="middle" fill="${color}" font-size="14" font-weight="bold">0</text>
        </g>
      `);
    } else {
      svgParts.push(`
        <g class="note-dot">
          <circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" ${n.isTonic ? 'stroke="#ffffff" stroke-width="3"' : ''} />
          <text x="${x}" y="${y + 5}" text-anchor="middle" fill="${textColor}" font-size="14" font-weight="bold">${escapeHTML(finger)}</text>
          <!-- Small note name label next to dot -->
          <text x="${x + 18}" y="${y + 5}" text-anchor="start" fill="#ffffff" font-size="11" font-weight="bold">${escapeHTML(n.name)}</text>
        </g>
      `);
    }
  });

  svgParts.push(`</svg>`);
  container.innerHTML = svgParts.join('');
}
