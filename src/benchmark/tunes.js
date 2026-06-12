/**
 * Benchmark fixtures: every abc/ tune, bundled as raw text, with ground
 * truth derived from the filename per R-008 — modal tunes map by third:
 * lydian/mixolydian -> major, dorian/phrygian -> minor.
 */

const abcFiles = import.meta.glob('../../abc/*.abc', { query: '?raw', import: 'default', eager: true });

const MODE_BY_THIRD = {
  major: 'major',
  lydian: 'major',
  mixolydian: 'major',
  minor: 'minor',
  dorian: 'minor',
  phrygian: 'minor'
};

export function groundTruthFromName(name) {
  const [tonic, mode] = name.split('_');
  const expectedMode = MODE_BY_THIRD[mode];
  if (!tonic || !expectedMode) throw new Error(`Cannot derive ground truth from abc filename: ${name}`);
  return { tonic: tonic.toUpperCase(), mode: expectedMode };
}

export const TUNES = Object.entries(abcFiles)
  .map(([path, text]) => {
    const name = path.split('/').pop().replace(/\.abc$/, '');
    return { name, text, expected: groundTruthFromName(name) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export function getTune(name) {
  const tune = TUNES.find(t => t.name === name);
  if (!tune) throw new Error(`Unknown tune: ${name}`);
  return tune;
}
