/**
 * Averages a history of chroma vectors.
 * @param {number[][]} history - An array of 12-dimensional chroma vectors.
 * @returns {number[] | null} A normalized 12-dimensional average chroma vector, or null if history is empty.
 */
export function getAveragedChroma(history) {
  if (history.length === 0) return null;

  const avg = new Float32Array(12).fill(0);

  // Sum all vectors
  for (const chroma of history) {
    for (let i = 0; i < 12; i++) {
      avg[i] += chroma[i];
    }
  }

  // Divide by number of vectors
  for (let i = 0; i < 12; i++) {
    avg[i] /= history.length;
  }

  // Normalize (so the max value is 1.0)
  const maxVal = Math.max(...avg);
  if (maxVal > 0) {
    for (let i = 0; i < 12; i++) {
      avg[i] /= maxVal;
    }
  }

  return Array.from(avg);
}
