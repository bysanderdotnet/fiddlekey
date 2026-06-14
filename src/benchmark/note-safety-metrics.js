/**
 * Note-safety benchmark metrics (IMPLEMENTATION.md Phase 4). Scores a
 * computeNoteSafety() result against practical jam metadata (abc/metadata.json):
 * which notes a player can actually get away with over this tune.
 *
 * Product rule: punish dangerous green notes harder than missing a safe note.
 * Better to show four safe notes than seven risky ones.
 */

const EMPTY_META = { safe: [], careful: [], avoid: [], ambiguous: [] };

function noteSet(list) {
  return new Set((list || []).map(x => (typeof x === 'string' ? x : x && x.note)).filter(Boolean));
}

function intersectCount(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * @param {Object|null} noteSafety result from computeNoteSafety()/detectionToNoteSafety()
 * @param {Object} meta expected { safe, careful, avoid, ambiguous } for the tune
 * @returns {Object} per-row metrics + score
 */
export function computeNoteSafetyMetrics(noteSafety, meta) {
  const m = { ...EMPTY_META, ...(meta || {}) };
  const expectedSafe = noteSet(m.safe);
  const expectedAvoid = noteSet(m.avoid);

  const ns = noteSafety || { safe: [], careful: [], avoid: [] };
  const green = noteSet(ns.safe);
  const careful = noteSet(ns.careful);
  const avoid = noteSet(ns.avoid);
  const greenOrCareful = new Set([...green, ...careful]);

  // Of notes shown green, how many are expected safe. No green output -> 0
  // (showing nothing is not useful; conservative means fewer green, not none).
  const usefulGreenCount = intersectCount(green, expectedSafe);
  const safePrecision = green.size ? usefulGreenCount / green.size : 0;

  // Of expected safe notes, how many did we surface at all (green OR careful).
  const safeRecall = expectedSafe.size ? intersectCount(expectedSafe, greenOrCareful) / expectedSafe.size : 1;

  // Notes shown green that metadata says avoid — the dangerous mistake.
  const dangerousGreenCount = intersectCount(green, expectedAvoid);

  // Notes we hid (avoid) that metadata says are safe — too conservative.
  const avoidFalseNegativeCount = intersectCount(avoid, expectedSafe);

  // Expected ambiguous pairs must be shown careful (not green). No pairs -> 1.
  const pairs = Array.isArray(m.ambiguous) ? m.ambiguous : [];
  let ambiguityHandled = 1;
  if (pairs.length) {
    let handled = 0;
    for (const pair of pairs) {
      const [a, b] = pair;
      const aOk = careful.has(a) && !green.has(a);
      const bOk = careful.has(b) && !green.has(b);
      if (aOk && bOk) handled++;
    }
    ambiguityHandled = handled / pairs.length;
  }

  const score =
    safePrecision * 0.45 +
    safeRecall * 0.25 +
    ambiguityHandled * 0.20 -
    dangerousGreenCount * 0.25;

  return {
    safePrecision,
    safeRecall,
    dangerousGreenCount,
    avoidFalseNegativeCount,
    usefulGreenCount,
    ambiguityHandled,
    score
  };
}

/** Per-detector rollup of note-safety metrics across benchmark rows. */
export function summarizeNoteSafety(results) {
  const byDetector = new Map();
  for (const row of results) {
    const nm = row.noteSafetyMetrics;
    if (!nm) continue;
    if (!byDetector.has(row.detectorId)) {
      byDetector.set(row.detectorId, {
        detectorId: row.detectorId, runs: 0,
        precSum: 0, recallSum: 0, scoreSum: 0, dangerousGreen: 0, avoidFalseNeg: 0
      });
    }
    const acc = byDetector.get(row.detectorId);
    acc.runs++;
    acc.precSum += nm.safePrecision;
    acc.recallSum += nm.safeRecall;
    acc.scoreSum += nm.score;
    acc.dangerousGreen += nm.dangerousGreenCount;
    acc.avoidFalseNeg += nm.avoidFalseNegativeCount;
  }
  return [...byDetector.values()].map(acc => ({
    detectorId: acc.detectorId,
    runs: acc.runs,
    avgSafePrecision: acc.runs ? acc.precSum / acc.runs : 0,
    avgSafeRecall: acc.runs ? acc.recallSum / acc.runs : 0,
    avgScore: acc.runs ? acc.scoreSum / acc.runs : 0,
    dangerousGreenTotal: acc.dangerousGreen,
    avoidFalseNegativeTotal: acc.avoidFalseNeg
  })).sort((a, b) => b.avgScore - a.avgScore);
}
