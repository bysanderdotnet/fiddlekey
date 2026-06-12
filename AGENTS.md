# Agent Operating Manual

One tool runs the whole workflow, prints next step every turn:

    ./AGENTS.sh init       # start here; follow output
    ./AGENTS.sh help       # stuck, or unsure which command fits

Trust script over memory: walks setup, scope, verification, progress,
handoff. All state in `.agents/agents.json`, CLI-owned — never hand-edit.

## Project

- Name: Fiddlekey
- Stack: Vanilla JS + Vite PWA; essentia.js / Web Audio detectors in a Web
  Worker; Vitest unit tests; Playwright e2e against production build.
- Purpose: Web app that listens to a jam session and detects the key —
  tonic + major/minor ONLY (no church modes; that was Bourdon's mistake).

## Rules

- One feature per session/commit. No drive-by refactors.
- Done = `./AGENTS.sh verify` green. Anything else = "unverified" — say so.
- `AGENTS.sh` / `.agents/agents.py` = harness internals. Usage = `help`,
  not reading or editing source.
- Never test via `vite dev` — always `npm run build` + static serve
  (`npm run preview`); dev bundles workers/WASM differently.
- Never commit large/binary assets (WAV, ONNX) — host on Cloudflare R2
  (see README). No Git LFS.
- Detection modes = `major`/`minor` only. Never reintroduce modal keys.

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
