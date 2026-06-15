# Agent Operating Manual

One tool runs the whole workflow, prints next step every turn:

    ./AGENTS.sh init       # start here; follow output
    ./AGENTS.sh help       # stuck, or unsure which command fits

Trust script over memory: walks setup, scope, verification, progress,
handoff. All state in `.agents/agents.json`, CLI-owned — never hand-edit.

## Project

- Name: Fiddlekey
- Stack: Vanilla JS + Vite PWA; essentia.js HPCP detector in a Web
  Worker; Vitest unit tests; Playwright e2e against production build.
- Purpose: Web app that listens to a jam session and tells the player which
  notes are safe to play now. Safe=green, careful=white, very-unsure=hidden.
  Note safety is the product output (see IMPLEMENTATION.md).
- Engine: detectors still compute tonic + major/minor ONLY internally (no
  church modes — Bourdon's mistake). Key label = debug, never the answer.

## Rules

- One feature per session/commit. No drive-by refactors.
- Done = `./AGENTS.sh verify` green. Anything else = "unverified" — say so.
- `AGENTS.sh` / `.agents/agents.py` = harness internals. Usage = `help`,
  not reading or editing source.
- Never test via `vite dev` — always `npm run build` + static serve
  (`npm run preview`); dev bundles workers/WASM differently.
- Never commit large/binary assets (e.g. WAV). No Git LFS.
- Detection modes = `major`/`minor` only. Never reintroduce modal keys.
- Product output = safe/careful/avoid notes (`computeNoteSafety`), not a key
  label. UI must not depend on `tonic`/`mode`. Pivot plan: IMPLEMENTATION.md.

## Skills

Skills = stored playbooks in `.agents/skills/<name>/SKILL.md`; `init` lists them.

- Task matches a skill → follow playbook, don't improvise.
- Just did recurring multi-step task (deploy, release, migration, codegen)?
  Capture as skill NOW, unprompted — scaffold: `./AGENTS.sh skill new <name>`;
  how-to: `.agents/skills/new-skill/SKILL.md`. Next session replays it,
  no re-deriving.

## Style: caveman

All agent output — chat, commits, code comments, logs, docs — max terse.
Drop filler; fragments fine: "Tests green. Lint: 2 unused imports." Exact
paths, commands, numbers; never paraphrase a name. Say once.

Only exception: the product itself (website copy, UI strings, end-user docs).
