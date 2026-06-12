export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

// Fiddlekey detects only the tonic plus major/minor — no church modes.
export const MODES = {
  MAJOR: 'major',
  MINOR: 'minor'
};

export function getFormattedMode(mode) {
  if (!mode) return '';
  const m = mode.toLowerCase();
  if (m === MODES.MAJOR) return 'Major';
  if (m === MODES.MINOR) return 'Minor';
  return mode;
}
