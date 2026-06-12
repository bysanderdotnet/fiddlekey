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

## Benchmark mode (planned, see feature list)

`/benchmark` lets coders measure the impact of their changes on detection quality:

- Uses the tunes in `abc/` as ground truth (filename encodes the key; modal tunes
  map to major/minor by their third: lydian/mixolydian → major, dorian/phrygian → minor).
- Converts ABC to WAV **on the fly** — generated audio is never committed.
- Streams the audio through every registered detector with a deterministic clock
  (`deterministicClock` option in `src/audio/worker.js`) and reports accuracy and
  time-to-detect per detector.

---

## Large assets: Cloudflare R2

GitHub blocks files over 100 MB and we do not use Git LFS. Any large binary
(ONNX models, audio) is hosted on Cloudflare R2 and fetched at runtime:

- Public base URL: `https://r2-bourdon.bysander.net` (bucket `r2-bourdon`,
  shared with the Bourdon project; currently hosts the HF key-class ONNX models)
- `r2-assets.json` lists what lives on R2 (destination path, content type, caching).

To view or edit the bucket, use any S3-compatible client with these environment
variables (set locally / as GitHub secrets, never committed):

| Variable | Description |
|---|---|
| `R2_ACCESS_KEY_ID` | R2 API token access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret access key |
| `R2_API_URL` | S3-compatible endpoint URL of the R2 account |

---

## Agent workflow

This repo uses an AI-agent harness. Start with `./AGENTS.sh init`; see
`AGENTS.md` for the operating manual and `./AGENTS.sh help` for all commands.
