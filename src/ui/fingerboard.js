import { getNoteOctaves } from '../theory/scale-helper.js';
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
 * Updates the SVG fingerboard from a note-safety result (IMPLEMENTATION.md
 * Phase 3). Colour by safety class, never by tonic/mode:
 *   safe    -> green  (strongest highlight)
 *   careful -> white  (weaker highlight)
 *   avoid / very unsure -> not drawn at all (a blank position beats a
 *   wrong-but-confident dot).
 * @param {Object|null} noteSafety { status, safe:[{note}], careful:[{note}] }
 */
export function updateFingerboard(noteSafety) {
  const container = document.getElementById('fingerboard');
  if (!container) return;

  if (!noteSafety || noteSafety.status === 'listening') {
    container.innerHTML = '';
    return;
  }

  try {
    const safe = (noteSafety.safe || []).map(e => e.note);
    const careful = (noteSafety.careful || []).map(e => e.note);

    if (safe.length === 0 && careful.length === 0) {
      container.innerHTML = '';
      return;
    }

    renderFingerboard(container, safe, careful);
  } catch (error) {
    console.error('Error updating fingerboard:', error);
  }
}

/**
 * Renders the SVG fingerboard.
 */
function renderFingerboard(container, safe, careful) {
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

  // Map safe + careful notes to fingerboard positions. Avoid notes are never
  // drawn — a blank position is better than a wrong-but-confident dot.
  const safeSet = new Set(safe);
  const notesToDisplay = [];
  [...safe, ...careful].forEach(noteName => {
    const isSafe = safeSet.has(noteName);
    const octaves = getNoteOctaves(noteName);

    octaves.forEach(noteWithOctave => {
      const midi = Note.midi(noteWithOctave);
      if (midi === null) return;

      // Check each string
      for (let s = 0; s < 4; s++) {
        const root = STRING_ROOTS[s];
        const pos = midi - root;
        // First position usually spans 7 semitones (up to 4th finger)
        if (pos >= 0 && pos <= 7) {
          notesToDisplay.push({ string: s, pos, name: noteName, isSafe });
        }
      }
    });
  });

  // Render dots
  notesToDisplay.forEach(n => {
    const x = margin.left + n.string * stringSpacing;
    const y = margin.top + n.pos * posHeight;

    // safe = green (strongest), careful = white (weaker).
    const color = n.isSafe ? 'var(--accent-color, #4caf50)' : '#ffffff';
    const textColor = n.isSafe ? '#ffffff' : '#000000';
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
        <g class="note-dot open-string ${n.isSafe ? 'safe' : 'careful'}">
          <circle cx="${x}" cy="${margin.top}" r="${radius}" fill="#121212" stroke="${color}" stroke-width="3" />
          <text x="${x}" y="${margin.top + 5}" text-anchor="middle" fill="${color}" font-size="14" font-weight="bold">0</text>
        </g>
      `);
    } else {
      svgParts.push(`
        <g class="note-dot ${n.isSafe ? 'safe' : 'careful'}">
          <circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" ${n.isSafe ? '' : 'stroke="#888" stroke-width="1"'} />
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
