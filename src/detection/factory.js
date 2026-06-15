/**
 * Detector registry. Every entry implements the KeyDetector interface and is
 * lazy-loaded so the app only pays for the detector it uses. The /benchmark
 * page iterates this registry to compare detectors against the ABC fixtures.
 */

export const DETECTORS = {
  essentia: {
    id: 'essentia',
    label: 'Essentia.js HPCP',
    loadDetectorClass: async () => (await import('../detectors/essentia-detector.js')).EssentiaDetector
  }
};

export const DEFAULT_DETECTOR_ID = 'essentia';

export function getDetectorOptions() {
  return Object.values(DETECTORS).map(({ id, label }) => ({ id, label }));
}

export function getDetectorIds() {
  return getDetectorOptions().map(({ id }) => id);
}

/**
 * Creates and returns an uninitialized KeyDetector instance by ID.
 * @param {string} id
 * @returns {Promise<KeyDetector>}
 */
export async function createDetector(id = DEFAULT_DETECTOR_ID) {
  const detector = DETECTORS[id];
  if (!detector) {
    throw new Error(`Unknown detector ID: ${id}`);
  }

  const DetectorClass = await detector.loadDetectorClass();
  return new DetectorClass();
}
