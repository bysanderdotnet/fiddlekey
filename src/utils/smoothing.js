/**
 * src/utils/smoothing.js
 *
 * Temporal smoothing of key estimates to prevent flickering.
 */

export class KeySmoother {
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
    this.history = [];
  }

  /**
   * Adds a new key estimate and returns the smoothed (majority) result.
   * @param {Object} estimate { tonic, mode }
   * @returns {Object} The most frequent { tonic, mode } in the window.
   */
  add(estimate) {
    if (!estimate) return null;

    this.history.push(estimate);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return this.getMajority();
  }

  /**
   * Returns the most frequent estimate in the current history window.
   */
  getMajority() {
    if (this.history.length === 0) return null;

    const counts = new Map();
    let maxCount = 0;
    let majority = this.history[this.history.length - 1]; // Default to latest

    for (const item of this.history) {
      const key = `${item.tonic}:${item.mode}`;
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);

      if (count >= maxCount) {
        maxCount = count;
        majority = item;
      }
    }

    return majority;
  }

  clear() {
    this.history = [];
  }
}
