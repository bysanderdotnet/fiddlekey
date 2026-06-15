# Fiddlekey 🎻

**A web app that tells you which notes are safe to play in a jam session.**

Fiddlekey listens to the music being played around you and answers the one
question a player actually has: **which notes can I play right now without
clashing?**

- 🟢 **Safe notes** — play these freely
- ⚪ **Careful notes** — usable, but listen first (shown in white)
- where to **put your fingers** on the violin, colour-coded by safety

No sheet music required. No internet required. No music theory required — you
do **not** need to know or care whether the tune is "D major". Just open it on
your phone and start playing.

> Fiddlekey used to lead with a *key* label (tonic + major/minor). It now
> leads with **safe notes**: the key is computed internally as an engine
> detail and is debug-only.

Fiddlekey is the successor of [Bourdon](https://github.com/bysanderdotnet/bourdon).
Bourdon tried to detect full church modes (Dorian, Mixolydian, ...) and grew too
complex. Fiddlekey keeps the good parts — the audio pipeline and the swappable
detectors — limits the engine to **tonic + major/minor**, and turns that into a
ranked set of **safe notes** rather than a theory label.

---

## The Problem

Folk jam sessions are intimidating for beginners. There is no conductor, no sheet
music handed out, and tunes start without warning. The hardest part is not playing
the notes — it is knowing *which* notes are safe to join in on. A beginner does
not need a theory label like "D major"; they need to know what to put their
fingers on. Once you know which notes are safe, your ear can do the rest.

---

## Features

| Feature | Description |
|---|---|
| 🟢 **Safe notes** | Ranks every note as **safe** (green), **careful** (white), or **avoid** (hidden) from live mic audio — no key label needed. |
| 🖐️ **Finger placement** | SVG violin fingerboard, first position; each note coloured by safety — green = safe, white = careful, very-unsure notes are left blank |
| 🤝 **Ambiguity-aware** *(in progress)* | When two notes (e.g. C / C#) are both plausible, both are shown as *careful* instead of guessing — conservative beats overconfident |
| 🎵 **Key engine** *(debug)* | Tonic + major/minor is still computed internally to feed safe-note scoring; it is no longer the product output and is hidden by default |
| 🔁 **Pluggable detector** | Detection sits behind one `KeyDetector` interface (currently Essentia.js HPCP); swap or add implementations in `src/detectors/` |
| 📱 **Works offline** | Fully client-side PWA — no server, no login, no internet needed at the session |
| 📊 **Benchmark mode** | `/benchmark` compares detectors on the ABC test tunes — accuracy, time-to-detect, and (planned) note-safety metrics |

---

## Getting Started (development)

```bash
npm install
npm run dev      # quick local hacking ONLY — never use for testing (see below)
npm run test     # unit tests (Vitest)
npm run e2e      # end-to-end tests (Playwright; builds + serves automatically)
npm run build    # production build to dist/
npm run preview  # serve dist/ on a local webserver
```

### Testing rule: always test the production build

`vite dev` does **not** bundle workers, WASM, and assets the same way as
`vite build`. A page that works on the dev server can break in production.
Therefore:

> **Always build the complete project and serve it on a local webserver
> (`npm run build && npm run preview`) for any testing or verification.
> Never test against `vite dev`.**

The Playwright config enforces this: `npm run e2e` builds the project and serves
`dist/` statically before running the tests.

---

## Architecture

```
index.html, src/main.js     App shell: start button, detector picker, PWA install, onboarding
src/audio/                  Mic capture → AudioWorklet (4096-sample PCM chunks) → Web Worker
src/detection/detector.js   KeyDetector interface: init / process / resetHistory / destroy
src/detection/factory.js    Detector registry (lazy-loaded); add new detectors here
src/detectors/              One file per detector implementation (essentia-detector.js)
src/detection/profile-matching.js
                            Krumhansl-Schmuckler major/minor profiles, Pearson scoring,
                            common-session-key prior — 24 candidates (12 tonics × 2 modes)
src/detection/note-safety-aggregator.js   (planned)
                            Adapts detector output → note safety; falls back to old
                            { tonic, mode } shape so the UI can migrate first
src/theory/scale-helper.js  Scale/pentatonic helpers (tonal.js)
src/theory/note-safety.js   (planned) The pivot core: candidates + chroma → safe/careful/avoid
src/ui/                     Safety-class note chips + colour-coded SVG fingerboard; status badge
abc/                        Test tunes in ABC notation, filename = ground-truth key
abc/metadata.json           (planned) Expected safe/careful/avoid notes per tune (jam advice)
tests/                      Vitest units + Playwright e2e (runs against the production build)
```

**Two layers.** The detection *engine* still emits plain objects
`{ tonic, mode, score, confidence, alternate, chroma }` where `mode` is always
`"major"` or `"minor"` — that is an internal/debug detail, not the product
output. The *product* output is a **note-safety** object from
`computeNoteSafety()`:

```js
{
  status: 'listening' | 'uncertain' | 'usable' | 'stable',
  safe:    [{ note: 'D', safety: 0.98, reason: 'anchor' }, ...],   // → green
  careful: [{ note: 'F#', safety: 0.64, reason: 'likely' }, ...],  // → white
  avoid:   ['F', 'G#', 'A#'],                                      // → hidden
  ambiguity: [{ notes: ['C', 'C#'], reason: 'both plausible' }],
  debug:   { candidates: [...], rawDetection: {} }                 // key label lives here
}
```

The UI renders `safe` / `careful` / `avoid` and **must not depend on `tonic`
or `mode`**. Fingerboard colour code: **safe → green, careful → white,
avoid / very-unsure → not drawn**.

### Adding a detector

1. Create `src/detectors/<name>-detector.js` extending `KeyDetector`.
2. Register it in `src/detection/factory.js`.
3. Compare it against the others in benchmark mode.

---

## Benchmark mode

The `/benchmark` page (`benchmark.html`, code in `src/benchmark/`) is the main
tool for **developing detectors**: after changing a detector, run the benchmark
to check whether the change actually improved accuracy or time-to-detect — and
use the per-detector summary table to decide which detector should be the
default (`DEFAULT_DETECTOR_ID` in `src/detection/factory.js`).

> **Note-safety scoring.** The benchmark scores **note safety** against
> `abc/metadata.json` (safe-note precision/recall, dangerous-green count,
> ambiguity handled) — punishing a clashing "safe" note harder than a missed
> one. Key correctness stays as a debug metric.

How it works:

- Uses the tunes in `abc/` as ground truth (filename encodes the key; modal tunes
  map to major/minor by their third: lydian/mixolydian → major, dorian/phrygian → minor).
- Synthesizes ABC to PCM **on the fly** with a fiddle-like tone
  (`src/benchmark/abc-synth.js`) — generated audio is never committed.
- Streams the audio through the **same worker pipeline the app uses**
  (`src/audio/worker.js`) so performance and behavior match the real app.
- Reports per (tune × detector): final detection, correctness, first-correct and
  settled time (in audio ms), update count, and wall-clock processing time.

### Selecting what to run

Running all tunes × all detectors gets very long. Both the UI (checkboxes) and
the programmatic API let you pick a subset:

```js
// In the browser console on /benchmark, or injected via Playwright:
const results = await window.fiddlekeyBenchmark.run({
  detectors: ['essentia'],            // omit or [] = all registered detectors
  tunes: ['c_major', 'a_minor'],      // omit or [] = all abc/ tunes
  durationSec: 30,                    // seconds of audio per tune
  noise: { type: 'session', snrDb: 10, seed: 1 }
});
```

Because the benchmark runs in the browser, drive it headlessly with Playwright:
open `/benchmark.html`, wait for `window.fiddlekeyBenchmark`, and `page.evaluate`
the call above (see `tests/benchmark.spec.js` for a working example). Running in
the real browser environment is deliberate — it ensures measured performance is
representative of the actual application.

### Determinism

Runs are reproducible: the synth uses no randomness, noise comes from a seeded
PRNG (per-tune seed derived from `seed ^ hash(tuneName)`, so a tune's noise
doesn't depend on which other tunes are selected), and the worker pins
`Date.now()` to the amount of audio processed (`deterministicClock`), so
detector emission timing doesn't depend on machine speed. Identical options →
identical detection traces; only `wallMs` (real processing time) varies.

### Noise simulation

Fiddle jam sessions happen in noisy pubs, so the benchmark can mix background
noise into the signal (`src/benchmark/noise.js`):

- `session` — typical jam ambience: crowd babble (amplitude-modulated pink
  noise voices), foot taps on the beat (~120 bpm low thumps), and occasional
  glass clinks.
- `babble` — crowd chatter only.
- `white` — worst-case broadband noise.
- `snrDb` sets signal-to-noise ratio: 20 ≈ quiet corner, 10 ≈ lively pub,
  0 = noise as loud as the tune.

---

## Agent workflow

This repo uses an AI-agent harness. Start with `./AGENTS.sh init`; see
`AGENTS.md` for the operating manual and `./AGENTS.sh help` for all commands.
