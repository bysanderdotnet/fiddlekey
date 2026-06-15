/**
 * src/ui/key-display.js
 *
 * Status badge for the note-safety result (IMPLEMENTATION.md Phase 3).
 * NOT a key label: never shows "D major". Reads only the note-safety
 * status + debug confidence — never tonic/mode as the product answer.
 */

const STATUS_BADGE = {
  listening: 'Still listening',
  uncertain: 'Unclear',
  usable: 'Safe notes found',
  stable: 'Safe notes found'
};

const STATUS_TEXT = {
  uncertain: 'Audio is ambiguous — try the dotted notes quietly.',
  usable: 'Green notes fit well — start there.',
  stable: 'Green notes fit well — start there.'
};

/**
 * Updates the status badge from a note-safety result.
 * @param {Object|null} noteSafety { status, debug:{ confidence } }
 */
export function updateKeyDisplay(noteSafety) {
  const container = document.getElementById('key-display');
  if (!container) return;

  const keyBadge = container.querySelector('.key-badge');
  const status = container.querySelector('.analysis-status');
  const confidenceBar = container.querySelector('.confidence-fill');

  if (!noteSafety || noteSafety.status === 'listening') {
    if (keyBadge) keyBadge.textContent = '---';
    if (status) status.textContent = '';
    if (confidenceBar) {
      confidenceBar.style.width = '0%';
      confidenceBar.className = 'confidence-fill status-none';
    }
    return;
  }

  if (keyBadge) keyBadge.textContent = STATUS_BADGE[noteSafety.status] ?? 'Safe notes found';
  if (status) status.textContent = STATUS_TEXT[noteSafety.status] ?? '';

  if (confidenceBar) {
    const confidence = noteSafety.debug?.confidence ?? 0;
    confidenceBar.style.width = `${Math.round(confidence * 100)}%`;
    confidenceBar.className = confidence < 0.2 ? 'confidence-fill status-low'
      : confidence < 0.5 ? 'confidence-fill status-medium'
        : 'confidence-fill status-high';
  }
}
