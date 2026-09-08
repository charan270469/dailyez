# Application Flow

1. Vite serves React on `http://localhost:3000` and proxies `/api` and
   `/auth/google` to Express on port `3001`.
2. `App` requests `/api/auth/status`; signed-out users see `LoginScreen` and
   signed-in users see `DashboardLayout`.
3. Selecting Google redirects through `/auth/google` to Google's OAuth chooser
   and consent screen. The request asks for offline access and a fresh consent
   grant so a refresh token is returned reliably.
4. Google redirects to `/auth/google/callback`. The backend exchanges the code,
   saves the refresh token, updates the Google profile, and immediately redirects
   to `http://localhost:3000/?gmail=connected`.
5. Gmail ingestion starts in the background after the redirect. It lists Gmail
   messages, fetches new message details, matches them against signals, and
   stores them in MongoDB.
6. The dashboard loads connection status and feed data through the `/api` proxy.
   Periodic, manual, and signal-creation fetches reuse the same Gmail ingestion
   pipeline.
7. Logout revokes Gmail, disconnects WhatsApp, marks the profile signed out,
   and returns the user to `LoginScreen`.

## Backend Startup

1. Express registers auth, voice, and WhatsApp routes and starts listening before
   the initial MongoDB connection completes.
2. MongoDB is connected during startup. A failed connection is logged, while
   individual requests report their own database failure and can retry after
   connectivity returns.
