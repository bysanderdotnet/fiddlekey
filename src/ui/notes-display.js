/**
 * src/ui/notes-display.js
 *
 * Renders the product output: safe / careful note chips from a note-safety
 * result (IMPLEMENTATION.md Phase 3). Does NOT read tonic/mode — the player
 * is asking what to play, not for a theory label.
 */

/**
 * Updates the notes display from a note-safety result.
 * @param {Object|null} noteSafety { status, safe, careful, ambiguity }
 */
export function updateNotesDisplay(noteSafety) {
  const container = document.getElementById('notes-display');
  if (!container) return;

  if (!noteSafety || noteSafety.status === 'listening') {
    container.innerHTML = '';
    container.style.opacity = '0';
    return;
  }

  container.style.opacity = '1';
  container.innerHTML = '';

  renderSection(container, 'Safe notes', noteSafety.safe, 'safe');
  renderSection(container, 'Careful', noteSafety.careful, 'careful');

  if (noteSafety.ambiguity && noteSafety.ambiguity.length) {
    renderAmbiguity(container, noteSafety.ambiguity);
  }
}

/**
 * Renders a labelled row of note chips. Skips empty sections.
 */
function renderSection(container, label, notes, safetyClass) {
  if (!notes || notes.length === 0) return;

  const section = document.createElement('div');
  section.className = `notes-section ${safetyClass}-section`;

  const heading = document.createElement('div');
  heading.className = 'notes-label';
  heading.textContent = label;
  section.appendChild(heading);

  const row = document.createElement('div');
  row.className = 'notes-row';

  notes.forEach(entry => {
    // ambiguous careful notes get their own chip class
    const cls = entry.reason === 'ambiguous' ? 'ambiguous' : safetyClass;
    row.appendChild(createNoteChip(entry.note, cls));
  });

  section.appendChild(row);
  container.appendChild(section);
}

/**
 * Renders "X / Y unclear" caution lines from ambiguity pairs.
 */
function renderAmbiguity(container, ambiguity) {
  const section = document.createElement('div');
  section.className = 'notes-section ambiguity-section';

  ambiguity.forEach(pair => {
    const line = document.createElement('div');
    line.className = 'ambiguity-line';
    line.textContent = `${pair.notes.join(' / ')} unclear`;
    section.appendChild(line);
  });

  container.appendChild(section);
}

/**
 * Helper to create a note chip element.
 */
function createNoteChip(note, safetyClass) {
  const chip = document.createElement('div');
  chip.className = `note-chip ${safetyClass}`;
  chip.textContent = note;
  return chip;
}
