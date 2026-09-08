# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---

### [2026-09-08 00:00] Prevent Gmail OAuth callback hangs
- Agent: Copilot
- What changed: Updated `server/authRoutes.js`, `server/index.js`, and `flow.md`.
- Why: Selecting a Google account left the browser waiting on the OAuth callback.
- Approach chosen: Redirect immediately after token/profile persistence, run Gmail ingestion in the background, request a fresh offline consent grant, and start Express before the initial MongoDB handshake.
- Alternatives considered: Increasing browser or database timeouts would preserve the blocking flow and would not fix slow Gmail matching.
- Trade-offs / risks: Gmail messages may appear shortly after the dashboard opens; MongoDB errors now surface per request instead of preventing the server from listening.
