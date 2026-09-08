---
description: Decision logging and app-flow documentation rules that apply to every code change in this repo, regardless of file type.
applyTo: '**'
---

# Project Instructions

## 1. Decision logging — DECISIONS.md

After completing the current task/prompt, update `DECISIONS.md` at the repo root:

- If `DECISIONS.md` does NOT exist, create it first with the header below, then add your entry.
- If it already exists, APPEND a new entry at the top (below the header). Never edit, rewrite, or delete past entries.
- Only log what THIS prompt/task actually changed — do not summarize unrelated past work, do not touch other agents' entries.
- Skip trivial edits (typos, formatting, comments only).

Entry format:

```
### [YYYY-MM-DD HH:MM] <short title>
- Agent: Copilot | Cline | Codex
- What changed: files/modules touched, one line
- Why: the problem or requirement that triggered this
- Approach chosen: what you did, and where (files/functions)
- Alternatives considered: what else was viable and why it lost
- Trade-offs / risks: anything the next person or agent should know
```

If creating the file fresh, use this header at the very top:

```
# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---
```

## 2. App flow documentation — FLOW.md

Maintain `FLOW.md` at the repo root as a living description of the app's runtime flow — from the user opening the app to closing it (entry point → init → user actions/screens → key backend calls → shutdown/cleanup).

- If `FLOW.md` does NOT exist, create it after your task and write the current end-to-end flow as best understood from the codebase.
- If it already exists and your change adds, removes, or alters a step in that flow (new screen, new route, new service call, removed feature, changed sequence), UPDATE the relevant section so it matches the current behavior. Do not leave it stale.
- If your change has no effect on app flow, leave FLOW.md untouched.
- Keep it as a structured step-by-step (numbered stages or a simple diagram-in-text), not prose paragraphs — this file should be skimmable to understand the whole app in one read.

## 3. Order of operations

Do the actual task first. Update FLOW.md if applicable. Then append to DECISIONS.md as the last step, describing everything you just did.