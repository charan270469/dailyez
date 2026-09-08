# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---

### [2026-09-08 00:00] Unify platform connection actions
- Agent: Copilot
- What changed: Updated `src/components/SettingsTab.tsx` so Gmail and WhatsApp each use one state-driven connection button.
- Why: Connected platforms should show only a red `Disconnect` action, while disconnected platforms should show only `Connect`.
- Approach chosen: Reused the existing connect and disconnect handlers and switched each button's label, click action, and styling from the platform connection state.
- Alternatives considered: Keeping separate reconnect and disconnect controls would preserve more actions but conflicts with the requested compact UI.
- Trade-offs / risks: Gmail no longer exposes a separate `Reconnect` action in Settings; reconnecting requires disconnecting and connecting again.

### [2026-09-08 00:00] Prevent Gmail OAuth callback hangs
- Agent: Copilot
- What changed: Updated `server/authRoutes.js`, `server/index.js`, and `flow.md`.
- Why: Selecting a Google account left the browser waiting on the OAuth callback.
- Approach chosen: Redirect immediately after token/profile persistence, run Gmail ingestion in the background, request a fresh offline consent grant, and start Express before the initial MongoDB handshake.
- Alternatives considered: Increasing browser or database timeouts would preserve the blocking flow and would not fix slow Gmail matching.
- Trade-offs / risks: Gmail messages may appear shortly after the dashboard opens; MongoDB errors now surface per request instead of preventing the server from listening.
