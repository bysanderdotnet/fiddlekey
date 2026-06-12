/**
 * src/ui/key-display.js
 *
 * Updates the UI with the detected key, mode, and confidence.
 */

import { NOTE_NAMES, getFormattedMode } from '../utils/notes.js';

/**
 * Updates the key display DOM elements.
 * @param {Object} detection { tonic, mode, confidence, alternate, score }
 */
export function updateKeyDisplay(detection) {
  const container = document.getElementById('key-display');
  if (!container) return;

  const keyBadge = container.querySelector('.key-badge');
  const confidenceBar = container.querySelector('.confidence-fill');

  if (!detection) {
    if (keyBadge) keyBadge.textContent = '---';
    if (confidenceBar) {
      confidenceBar.style.width = '0%';
      confidenceBar.className = 'confidence-fill status-none';
    }
    return;
  }

  const { tonic, mode, confidence, score } = detection;
  const tonicName = typeof tonic === 'number' ? NOTE_NAMES[tonic] : tonic;
  const formattedMode = getFormattedMode(mode);

  // 1. Update Key Badge
  if (keyBadge) {
    keyBadge.textContent = `${tonicName} ${formattedMode}`;
  }

  // 2. Update Confidence Bar
  if (confidenceBar) {
    const percentage = Math.round(confidence * 100);
    confidenceBar.style.width = `${percentage}%`;

    // Color logic
    if (confidence < 0.2) {
      confidenceBar.className = 'confidence-fill status-low';
    } else if (confidence < 0.5) {
      confidenceBar.className = 'confidence-fill status-medium';
    } else {
      confidenceBar.className = 'confidence-fill status-high';
    }
  }

}
