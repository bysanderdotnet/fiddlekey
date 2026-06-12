# Fiddlekey 🎻

**A web app that automatically detects the key of a jam session.**

Fiddlekey listens to the music being played around you and instantly tells you:
- what **key** the tune is in — the tonic plus **major or minor**, nothing fancier
- which **notes are safe to play**
- where to **put your fingers** on the violin

No sheet music required. No internet required. Just open it on your phone and start playing.

Fiddlekey is the successor of [Bourdon](https://github.com/bysanderdotnet/bourdon).
Bourdon tried to detect full church modes (Dorian, Mixolydian, ...) and grew too
complex. Fiddlekey keeps the good parts — the audio pipeline and the swappable
detectors — and deliberately limits detection to **tonic + major/minor**.

---

## The Problem

Folk jam sessions are intimidating for beginners. There is no conductor, no sheet
music handed out, and tunes start without warning. The hardest part is not playing
the notes — it is knowing *which* notes are safe, and in *what key* the tune is
running. Once you have that, your ear can do the rest.

---

## Features

| Feature | Description |
|---|---|
| 🎵 **Key detection** | Detects the tonic and major/minor (D Major, A Minor, ...) from live microphone audio within seconds |
| 🔁 **Swappable detectors** | Multiple key-detection algorithms behind one `KeyDetector` interface; pick one in Settings |
| 🟢 **Safe notes** | Shows the pentatonic tones and the full 7-note scale for the detected key |
| 🖐️ **Finger placement** | SVG violin fingerboard showing string and finger for each safe note, in first position |
| 📱 **Works offline** | Fully client-side PWA — no server, no login, no internet needed at the session |
| 📊 **Benchmark mode** (planned) | `/benchmark` compares detector accuracy and speed on the ABC test tunes |

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
src/detection/specifics/    One file per detector implementation
src/detection/profile-matching.js
                            Krumhansl-Schmuckler major/minor profiles, Pearson scoring,
                            common-session-key prior — 24 candidates (12 tonics × 2 modes)
src/theory/                 Scale/pentatonic helpers (tonal.js)
src/ui/                     Key badge, safe-notes chips, SVG fingerboard
abc/                        Test tunes in ABC notation, filename = ground-truth key
tests/                      Playwright e2e (runs against the production build)
```

Detection results are plain objects: `{ tonic, mode, score, confidence, alternate, chroma }`
where `mode` is always `"major"` or `"minor"`.

### Adding a detector

1. Create `src/detection/specifics/<name>-detector.js` extending `KeyDetector`.
2. Register it in `src/detection/factory.js`.
3. Compare it against the others in benchmark mode.

---

## Benchmark mode

The `/benchmark` page (`benchmark.html`, code in `src/benchmark/`) is the main
tool for **developing detectors**: after changing a detector, run the benchmark
to check whether the change actually improved accuracy or time-to-detect — and
use the per-detector summary table to decide which detector should be the
default (`DEFAULT_DETECTOR_ID` in `src/detection/factory.js`).

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
  detectors: ['essentia', 'meyda'],   // omit or [] = all registered detectors
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

## Large assets: Cloudflare R2

GitHub blocks files over 100 MB and we do not use Git LFS. Any large binary
(ONNX models, audio) is hosted on Cloudflare R2 and fetched at runtime:

- Public base URL: `https://r2-fiddlekey.bysander.net` (currently hosts the
  HF key-class ONNX models)
- `r2-assets.json` lists what lives on R2 (destination path, content type, caching).

Uploads to the bucket are done by a human — agents have no R2 credentials and
must not assume write access. To get a new large asset (e.g. an ONNX model)
onto R2:

1. Prepare a script that downloads or generates the asset (never commit the
   asset itself).
2. Suggest a destination path under the base URL (e.g. `models/<name>.onnx` —
   lowercase, hyphenated, with quantization/variant suffix where relevant).
3. Add the entry to `r2-assets.json` and ask the human to run the script and
   upload the result.

---

## Agent workflow

This repo uses an AI-agent harness. Start with `./AGENTS.sh init`; see
`AGENTS.md` for the operating manual and `./AGENTS.sh help` for all commands.
