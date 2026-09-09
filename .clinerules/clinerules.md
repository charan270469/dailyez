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

# DailyEz — Agent Instructions

## Environment
- Windows, Git Bash / PowerShell terminal. Never use && or > redirection syntax 
  (Bash/CMD only) — use ; to chain commands, and Select-String instead of findstr 
  for searches.
- Prefer your file read/write tools over shelling out to search commands. Only 
  use terminal commands for running/testing the app, not for searching code you 
  already have direct file access to.

## Scope discipline
- Before editing, state which files you will touch. If a fix is described as 
  affecting one file, do not open or modify others "just in case."
- Do not investigate library internals (node_modules) unless explicitly asked to. 
  If behavior is unclear, ask rather than digging through a dependency's source.
- For a one-line or few-line fix, make a targeted edit. Do not rewrite a whole 
  file or function for a small change.
- Do not add new abstractions, config layers, or files unless the task requires 
  it. Match existing patterns in the codebase.

## Workflow
- For any non-trivial or ambiguous bug, report your diagnosis and root cause 
  first, and wait for confirmation before writing a fix.
- Work in the stages given in the prompt. Stop after each stage and report what 
  to test before continuing.
- After a fix, state exactly how to test it. Don't just say "this should work."

## Stack context
[reuse the DailyEz context block you already built earlier — architecture, 
current phase, what's Gmail-only vs WhatsApp vs stubbed, key file locations]