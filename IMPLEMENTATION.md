# IMPLEMENTATION.md — Note Safety Pivot

## Goal

Fiddlekey should answer the practical jam-session question:

> Which notes can I play now without clashing?

The app should no longer be designed around showing a key first. A key label may remain available for debugging or advanced display, but the product output is a ranked set of notes.

Current flow:

```txt
microphone audio -> detector -> tonic/mode -> pentatonic + scale notes -> fingerboard
```

Target flow:

```txt
microphone audio -> detector evidence -> note safety scoring -> green/yellow/red notes -> fingerboard
```

## Product rule

Optimise for useful conservative notes, not theoretical key correctness.

A wrong key label can still produce a useful safe-note set. A correct-but-overconfident key label can still mislead a beginner if the seventh, third, or modal colour is ambiguous.

## Non-goals

- Do not make users care about major/minor.
- Do not show modal labels such as dorian, mixolydian, lydian, or phrygian in the main UI.
- Do not make the safe notes depend on a single winning key.
- Do not commit large audio/model assets.
- Do not require ONNX/HF detectors for the first implementation.
- Do not remove the existing detector interface in the first pass.

Existing detectors may still internally emit `tonic` and `mode` because the current code is built that way. Treat that as detector internals, not product output.

## New user-facing model

The main result should be note-focused:

```js
{
  status: 'listening' | 'uncertain' | 'usable' | 'stable',
  safe: [
    { note: 'D', safety: 0.98, reason: 'anchor' },
    { note: 'A', safety: 0.95, reason: 'anchor' },
    { note: 'E', safety: 0.86, reason: 'common' },
    { note: 'B', safety: 0.78, reason: 'common' }
  ],
  careful: [
    { note: 'F#', safety: 0.64, reason: 'likely' },
    { note: 'G', safety: 0.61, reason: 'likely' },
    { note: 'C', safety: 0.37, reason: 'ambiguous' },
    { note: 'C#', safety: 0.35, reason: 'ambiguous' }
  ],
  avoid: ['F', 'G#', 'A#'],
  ambiguity: [
    { notes: ['C', 'C#'], reason: 'both versions are plausible; use carefully' }
  ],
  debug: {
    candidates: [
      { tonic: 'D', mode: 'major', weight: 0.52 },
      { tonic: 'G', mode: 'major', weight: 0.31 },
      { tonic: 'B', mode: 'minor', weight: 0.17 }
    ],
    rawDetection: {}
  }
}
```

The UI should render `safe`, `careful`, and optionally `avoid`. It should not require `tonic` or `mode`.

## UI language

Use player-friendly copy.

Preferred:

```txt
Safe notes
D A E B

Probably safe
F# G

Careful
C / C# unclear
```

Avoid:

```txt
D major
Confidence 58%
```

The player is not asking for a theory label. The player is asking what to play.

## New modules

### `src/theory/note-sets.js`

Purpose: basic note and interval helpers.

Exports:

```js
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteToIndex(note) {}
export function indexToNote(index) {}
export function transpose(note, semitones) {}
export function uniqueNotes(notes) {}
```

This should use the existing note constants if possible. Do not duplicate source-of-truth note naming if `src/utils/notes.js` already provides it.

### `src/theory/note-safety.js`

Purpose: convert detector evidence into safe/careful/avoid notes.

Public API:

```js
export function computeNoteSafety({ candidates, observedChroma, options } = {}) {
  return {
    status,
    safe,
    careful,
    avoid,
    ambiguity,
    debug
  };
}
```

This module is the core of the pivot.

### `src/detection/note-safety-aggregator.js`

Purpose: adapt existing detector output to `computeNoteSafety()`.

Public API:

```js
export function detectionToNoteSafety(detection) {
  if (!detection) return null;

  const candidates = getCandidatesFromDetection(detection);

  return computeNoteSafety({
    candidates,
    observedChroma: detection.chroma,
    options: DEFAULT_NOTE_SAFETY_OPTIONS
  });
}
```

The UI should call this once per detection result and then render the note-safety result.

## Candidate handling

Current detectors usually return a single top key plus one alternate. That is not enough. Use the full candidate ranking where possible.

### Change `src/detection/profile-matching.js`

Keep the existing functions for compatibility.

Add:

```js
export function detectKeyCandidates(chroma, options = {}) {
  return scoreKeyCandidates(chroma, options).map(candidate => ({
    tonic: candidate.tonicName,
    mode: candidate.mode,
    score: candidate.score,
    rawScore: candidate.rawScore
  }));
}
```

This still uses `mode` internally because the current candidate scorer is built around 24 key profiles. That is acceptable. The note-safety layer must not expose this as the main product answer.

### Update detector outputs

Where a detector already computes averaged chroma and calls `detectKey()`, also attach candidates:

```js
const candidates = detectKeyCandidates(averagedChroma).slice(0, 5);
const rawDetection = detectKey(averagedChroma);
rawDetection.candidates = candidates;
```

Start with:

```txt
src/detection/specifics/essentia-detector.js
src/detection/specifics/webaudio-pcp-detector.js
src/detection/specifics/meyda-detector.js
src/detection/specifics/essentia-nnls-detector.js
src/detection/specifics/ensemble-detector.js
```

Do not block the feature on HF/ONNX detectors.

### Fallback when candidates are missing

`detectionToNoteSafety()` should support old detector output:

```js
function getCandidatesFromDetection(detection) {
  if (Array.isArray(detection.candidates) && detection.candidates.length) {
    return detection.candidates;
  }

  const fallback = [];

  if (detection.tonic) {
    fallback.push({
      tonic: detection.tonic,
      mode: detection.mode,
      score: detection.score ?? detection.confidence ?? 1
    });
  }

  if (detection.alternate?.tonic) {
    fallback.push({
      tonic: detection.alternate.tonic,
      mode: detection.alternate.mode ?? detection.mode,
      score: detection.alternate.score ?? 0.5
    });
  }

  return fallback;
}
```

This lets the UI migrate before every detector is perfect.

## Note safety scoring

### Input

Use only the top plausible candidates, not all 24.

```js
const DEFAULT_NOTE_SAFETY_OPTIONS = {
  maxCandidates: 5,
  candidateScoreWindow: 0.18,
  safeThreshold: 0.68,
  carefulThreshold: 0.32,
  observedChromaBonus: 0.15,
  anchorBonus: 0.15,
  pentatonicBonus: 0.12,
  ambiguityPenalty: 0.08
};
```

Candidate filtering:

```js
const topScore = candidates[0].score;
const plausible = candidates
  .filter(c => c.score >= topScore - candidateScoreWindow)
  .slice(0, maxCandidates);
```

Normalise plausible scores into weights.

### Internal templates

Do not show these names in the UI. They are just note-set templates.

```js
const INTERNAL_NOTE_TEMPLATES = {
  major: {
    scale: [0, 2, 4, 5, 7, 9, 11],
    pentatonic: [0, 2, 4, 7, 9],
    shadow: [0, 2, 4, 5, 7, 9, 10]
  },
  minor: {
    scale: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 3, 5, 7, 10],
    shadow: [0, 2, 3, 5, 7, 9, 10]
  }
};
```

`shadow` exists only to avoid over-committing when the tune behaves like common folk modality. The UI must not say `mixolydian` or `dorian`.

### Degree weights

```js
const DEGREE_WEIGHTS = new Map([
  [0, 1.00],  // centre / anchor
  [7, 0.95],  // fifth / anchor
  [4, 0.82],  // major third
  [3, 0.82],  // minor third
  [2, 0.75],  // second
  [9, 0.72],  // sixth
  [5, 0.55],  // fourth
  [10, 0.45], // flat seventh
  [11, 0.35], // major seventh
  [8, 0.35],  // minor sixth
  [1, 0.10],
  [6, 0.10]
]);
```

### Score calculation

For each plausible candidate:

1. Convert candidate tonic to pitch-class index.
2. Add weighted support for its scale notes.
3. Add extra support for pentatonic notes.
4. Add extra support for anchor notes: centre and fifth.
5. Add reduced support for shadow notes.
6. Add small observed-chroma bonus.
7. Penalise unresolved ambiguous pairs.

Pseudo-code:

```js
const scores = new Map(NOTE_NAMES.map(note => [note, 0]));

for (const candidate of plausibleCandidates) {
  const tonic = noteToIndex(candidate.tonic);
  const template = INTERNAL_NOTE_TEMPLATES[candidate.mode] ?? INTERNAL_NOTE_TEMPLATES.major;

  for (const interval of template.scale) {
    const note = indexToNote(tonic + interval);
    scores.set(note, scores.get(note) + candidate.weight * degreeWeight(interval));
  }

  for (const interval of template.pentatonic) {
    const note = indexToNote(tonic + interval);
    scores.set(note, scores.get(note) + candidate.weight * pentatonicBonus);
  }

  for (const interval of [0, 7]) {
    const note = indexToNote(tonic + interval);
    scores.set(note, scores.get(note) + candidate.weight * anchorBonus);
  }

  for (const interval of template.shadow) {
    const note = indexToNote(tonic + interval);
    scores.set(note, scores.get(note) + candidate.weight * 0.18);
  }
}
```

After scoring, normalise all notes into `0..1`.

### Observed chroma

If a detector result includes `chroma`, add a small bonus to notes actually present in the audio.

```js
for (let i = 0; i < 12; i++) {
  const note = indexToNote(i);
  scores.set(note, scores.get(note) + observedChroma[i] * observedChromaBonus);
}
```

Keep this bonus small. Chroma can be polluted by harmonics, drones, accompaniment, and noise.

### Ambiguity handling

Detect pairs where both notes are plausible but neither is clearly dominant:

```txt
C / C#
F / F#
G / G#
A# / B
D# / E
```

Start with chromatic neighbour pairs that both exceed `carefulThreshold` and have a small score gap.

```js
if (scoreA >= carefulThreshold && scoreB >= carefulThreshold && Math.abs(scoreA - scoreB) < 0.18) {
  markBothAsCareful();
  addAmbiguity({ notes: [noteA, noteB], reason: 'unclear from current audio' });
}
```

Do not show this as failure. Show it as useful caution.

## Status rules

`status` should reflect practical usefulness.

```js
if no detection -> 'listening'
else if safe.length < 3 -> 'uncertain'
else if safe.length >= 3 and safe.length < 5 -> 'usable'
else -> 'stable'
```

The UI can still show careful notes while status is `uncertain`, but should avoid strong language.

Suggested UI copy:

```txt
Still listening. Try these quietly: D A
```

## UI implementation

### Change `src/main.js`

Current code calls:

```js
updateKeyDisplay(detection);
updateNotesDisplay(detection);
updateFingerboard(detection);
```

Replace with:

```js
const noteSafety = detectionToNoteSafety(detection);
updateNotesDisplay(noteSafety);
updateFingerboard(noteSafety);
updateKeyDisplay(noteSafety?.debug ?? null); // optional / debug only
```

The primary render path must no longer depend on `detection.tonic` or `detection.mode`.

Also rename UI concepts where practical:

- button text may remain `Detect key` for now, but should become `Find safe notes`
- status text should become `Listening for safe notes...`
- internal function `showSettledKey()` should eventually become `showSettledNotes()`

Do this rename in a separate cleanup commit if it makes the diff too large.

### Replace `src/ui/notes-display.js`

Current file renders pentatonic and full-scale chips from `tonic/mode`. Replace it with rendering of `safe`, `careful`, and optionally `avoid`.

New behaviour:

```js
export function updateNotesDisplay(noteSafety) {
  if (!noteSafety || noteSafety.status === 'listening') {
    clear container;
    return;
  }

  renderSection('Safe notes', noteSafety.safe, 'safe');
  renderSection('Careful', noteSafety.careful, 'careful');

  if (noteSafety.ambiguity.length) {
    renderAmbiguity(noteSafety.ambiguity);
  }
}
```

Chip classes:

```txt
note-chip safe
note-chip careful
note-chip avoid
note-chip ambiguous
```

### Update `src/ui/fingerboard.js`

The fingerboard should highlight notes by safety class rather than by pentatonic/full-scale membership.

Expected input:

```js
{
  safe: [{ note: 'D' }, { note: 'A' }],
  careful: [{ note: 'F#' }, { note: 'C' }],
  avoid: ['F', 'G#']
}
```

Colour code (safety class → fingerboard dot colour):

- safe → **green** (strongest highlight)
- careful / unsure → **white** (weaker highlight)
- avoid / very unsure → **not drawn at all** (hidden)

Render rules:

- safe notes: green, strongest highlight
- careful notes: white, weaker highlight
- avoid notes and anything we are very unsure about: do not draw the dot —
  leave the position blank rather than guess
- if no safe notes: clear fingerboard or show listening state

The fingerboard must never show a coloured dot for a note we are very unsure
about. A blank position is better than a wrong-but-confident one.

### Update `src/ui/key-display.js`

The key badge should not dominate the app.

Options:

1. Hide it by default.
2. Replace it with a status badge: `Safe notes found`, `Still listening`, `Unclear`.
3. Put likely key/debug details behind a details element.

Preferred first pass:

```txt
Status badge: Safe notes found
Small text: Based on several possible key areas
```

Do not show `D major` as the main result.

## Benchmark changes

Current benchmark measures exact key correctness. Add note-safety metrics.

### Add expected safe notes to fixtures

Create fixture metadata separate from ABC filenames:

```txt
abc/metadata.json
```

Example:

```json
{
  "d_major_reel": {
    "safe": ["D", "E", "F#", "A", "B"],
    "careful": ["G", "C#", "C"],
    "avoid": ["F", "G#", "A#"],
    "notes": "D-ish tune; C/C# may be context-dependent in folk settings."
  }
}
```

Do not try to make this theoretically perfect. The metadata should encode practical jam advice.

### Add metrics

For every benchmark row, compute:

```js
{
  safePrecision,
  safeRecall,
  avoidFalseNegativeCount,
  dangerousGreenCount,
  usefulGreenCount,
  ambiguityHandled
}
```

Definitions:

- `safePrecision`: of notes marked green, how many are expected safe?
- `safeRecall`: of expected safe notes, how many did we mark green or careful?
- `dangerousGreenCount`: notes marked green that metadata says avoid.
- `avoidFalseNegativeCount`: notes marked avoid that metadata says safe.
- `ambiguityHandled`: expected ambiguous pairs were shown as careful, not green.

Primary score should punish dangerous green notes more than missing a safe note.

```js
score = safePrecision * 0.45
      + safeRecall * 0.25
      + ambiguityHandled * 0.20
      - dangerousGreenCount * 0.25
```

This matches the product goal: better to be conservative than to tell the user to play a clashing note.

## Tests

### Unit tests

Create:

```txt
tests/note-safety.test.js
```

Test cases:

1. D/G/Bm ambiguity produces common safe notes.
2. C/C# ambiguity becomes careful, not green.
3. A single confident candidate produces pentatonic notes as safe.
4. Low candidate scores return `uncertain`.
5. Observed chroma can raise a note from avoid to careful but not automatically to safe.
6. Missing candidates returns null or listening state.
7. Duplicate enharmonic-ish inputs do not duplicate chips.

Example assertion:

```js
const result = computeNoteSafety({
  candidates: [
    { tonic: 'D', mode: 'major', score: 0.90 },
    { tonic: 'G', mode: 'major', score: 0.82 },
    { tonic: 'B', mode: 'minor', score: 0.78 }
  ]
});

expect(notes(result.safe)).toContain('D');
expect(notes(result.safe)).toContain('A');
expect(notes(result.careful)).toEqual(expect.arrayContaining(['C', 'C#']));
```

### UI tests

Update Playwright tests so the expected result is no longer a key badge.

Assert:

- safe-note chips render
- careful-note chips render
- fingerboard highlights safe notes
- app does not crash when detector emits only old-style `{ tonic, mode }`
- low-confidence result does not show overconfident safe notes

### Benchmark tests

Update benchmark row output to include `noteSafety` next to the raw detection.

Do not remove current key metrics yet. Keep them as debug metrics until note-safety scoring is stable.

## Rollout plan

### Phase 1 — Add note-safety core

Files:

```txt
src/theory/note-safety.js
src/detection/note-safety-aggregator.js
tests/note-safety.test.js
```

No UI changes yet.

Acceptance criteria:

- unit tests pass
- old detector output can be converted into note-safety result
- candidate-rich output produces better ambiguity handling than single-key output

### Phase 2 — Expose detector candidates

Files:

```txt
src/detection/profile-matching.js
src/detection/specifics/essentia-detector.js
src/detection/specifics/webaudio-pcp-detector.js
src/detection/specifics/meyda-detector.js
src/detection/specifics/essentia-nnls-detector.js
src/detection/specifics/ensemble-detector.js
```

Acceptance criteria:

- detectors still satisfy existing interface
- each updated detector includes `candidates`
- old UI still works
- tests pass

### Phase 3 — Replace notes UI

Files:

```txt
src/main.js
src/ui/notes-display.js
src/ui/fingerboard.js
src/ui/key-display.js
```

Acceptance criteria:

- main screen leads with safe notes
- `tonic/mode` no longer required by notes UI
- key display is secondary or status-only
- fingerboard can distinguish safe and careful notes

### Phase 4 — Benchmark note safety

Files:

```txt
src/benchmark/runner.js
src/benchmark/ui.js
abc/metadata.json
tests/benchmark.spec.js
```

Acceptance criteria:

- benchmark reports note-safety metrics
- exact key correctness remains visible only as debug/comparison
- dangerous green notes are easy to identify

### Phase 5 — Tune thresholds with real audio

Add real recorded fixtures only if they are small enough for GitHub. Otherwise document R2 upload steps and keep metadata in the repo.

Acceptance criteria:

- thresholds are based on benchmark results, not guessing
- noisy clips prefer conservative output
- ambiguous clips show careful notes instead of overconfident green notes

## Acceptance criteria for the whole pivot

The feature is done when:

- the app can show useful safe notes without showing a key
- the UI does not depend on `major` or `minor`
- ambiguous notes are shown as careful
- benchmark includes note-safety metrics
- detectors still work through the existing worker pipeline
- `npm run test` passes
- `npm run e2e` passes
- final verification uses production build, not `vite dev`

## Implementation notes

- Keep changes small. One phase per commit.
- Do not delete existing key detection yet; demote it.
- Do not rewrite all detectors at once.
- Start with deterministic unit tests for `computeNoteSafety()`.
- Make the UI conservative. It is better to show four safe notes than seven risky notes.
- The first version can be simple. The important architectural change is that notes are the product output, not key labels.
