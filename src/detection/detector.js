/**
 * src/detection/detector.js
 *
 * Abstract base class for key detection implementations.
 */

export class KeyDetector {
  /**
   * Initialize any required libraries, wasm, or internal state.
   * @param {number} sampleRate
   * @param {number} bufferSize
   * @param {(progress: { loaded: number, total: number }) => void} [onProgress]
   *   Optional callback invoked while large assets (e.g. R2 models) download.
   * @returns {Promise<void>}
   */
  async init(sampleRate, bufferSize, onProgress) {
    throw new Error('Method "init()" must be implemented.');
  }

  /**
   * Process a single chunk of PCM audio.
   * Manages its own internal accumulation window and temporal smoothing.
   * @param {Float32Array} float32Array
   * @returns {Object|null} DetectionResult or null if more data is needed.
   */
  process(float32Array) {
    throw new Error('Method "process()" must be implemented.');
  }

  /**
   * Clears internal history and smoothing state.
   */
  resetHistory() {
    throw new Error('Method "resetHistory()" must be implemented.');
  }

  /**
   * Release any resources.
   */
  destroy() {
    throw new Error('Method "destroy()" must be implemented.');
  }
}
