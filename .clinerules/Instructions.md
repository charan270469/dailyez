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