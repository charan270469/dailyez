# Setup Guide — SignalStream

This guide walks you through running the SignalStream application locally and connecting it to your Gmail account.

---

## Prerequisites

- **Node.js** (v18 or later)
- **npm** (comes with Node.js)
- A **MongoDB** instance (local or cloud, e.g. [MongoDB Atlas](https://www.mongodb.com/atlas))
- A **Google Cloud Project** with the Gmail API enabled

---

## 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd signalstream
npm install
```

---

## 2. Configure Environment Variables

Copy the example environment variables into a `.env` file (or rename the existing one):

```bash
# The .env file already exists — make sure it has all required values
```

The `.env` file should contain the following:

```env
# ── Google OAuth credentials ──
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# ── Frontend URL (used after OAuth login) ──
FRONTEND_URL=http://localhost:3000

# ── MongoDB connection string ──
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=<app-name>

# ── (Optional) Backend port; defaults to 3001 ──
# PORT=3001
```

> **Important:** The `.env` file in this repository already contains pre-filled values. Replace them with your own credentials before running.

---

## 3. Run the Application

You need two terminals — one for the frontend and one for the backend.

### Terminal 1 — Backend (Express API server)

```bash
npm run dev:server
```

The backend starts on **http://localhost:3001**.

### Terminal 2 — Frontend (Vite dev server)

```bash
npm run dev
```

The frontend starts on **http://localhost:3000**.

Open **http://localhost:3000** in your browser.

---

## 4. Connect Gmail

The app uses **Google OAuth 2.0** to read Gmail messages. Follow these steps to set up the connection from scratch.

### 4.1 — Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Navigate to **APIs & Services > Library**.
4. Search for **Gmail API** and click **Enable**.

### 4.2 — Configure the OAuth Consent Screen

1. In **APIs & Services > OAuth consent screen**:
   - Choose **External** user type (or Internal if you use a Google Workspace account).
   - Fill in the **App name**, **User support email**, and **Developer contact information**.
   - Under **Scopes**, add the following scope:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Under **Test users**, add your Google email address.
   - Save and continue.

### 4.3 — Create OAuth Credentials

1. In **APIs & Services > Credentials**, click **+ Create Credentials > OAuth client ID**.
2. Choose **Web application**.
3. Under **Authorized JavaScript origins**, add:
   - `http://localhost:3000`
   - `http://localhost:3001`
4. Under **Authorized redirect URIs**, add:
   - `http://localhost:3001/auth/google/callback`
5. Click **Create**.
6. Copy the **Client ID** and **Client Secret**.

### 4.4 — Update `.env` with Your Credentials

Edit your `.env` file and set:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
```

### 4.5 — Authenticate with Gmail

There are two ways to start the OAuth flow:

#### Option A — From the Browser UI

1. Open **http://localhost:3000**.
2. Click the **Connect Gmail** button in the dashboard.
3. You'll be redirected to Google's consent screen.
4. Approve the requested permissions.
5. You'll be redirected back to the app (**http://localhost:3000/?gmail=connected**).

#### Option B — Direct API Call

Visit the following URL directly in your browser:

```
http://localhost:3001/auth/google
```

After approving, Google redirects to `http://localhost:3001/auth/google/callback`. The backend:

- Exchanges the authorization code for tokens.
- Saves the **refresh token** in MongoDB (in the `users` collection).
- Fetches recent Gmail messages and stores them in the `messages` collection.
- Finally redirects you to `http://localhost:3000/?gmail=connected`.

### 4.6 — Verify the Connection

Check the connection status by visiting:

```
http://localhost:3001/api/auth/status
```

You should see:

```json
{
  "gmail": true,
  "whatsapp": false
}
```

---

## 5. API Endpoints (Quick Reference)

| Method | Endpoint                        | Description                                 |
|--------|---------------------------------|---------------------------------------------|
| GET    | `/auth/google`                  | Initiate Google OAuth flow                  |
| GET    | `/auth/google/callback`         | OAuth callback (handled automatically)      |
| GET    | `/api/auth/status`              | Check connection status for all integrations |
| POST   | `/api/gmail/fetch`              | Manually trigger a Gmail fetch & sync       |
| GET    | `/messages`                     | Get all stored messages (raw)               |
| GET    | `/stored-messages`              | Get all stored messages (sorted)            |
| GET    | `/api/messages/inbox`           | Get all inbox messages                      |
| GET    | `/api/messages/important`       | Get messages matched against watchlist      |
| GET    | `/api/messages/archive`         | Get archived messages                       |
| PATCH  | `/api/messages/:id/archive`     | Archive a specific message                  |
| PATCH  | `/api/messages/:id/restore`     | Restore an archived message                 |
| GET    | `/api/watchlist`                | Get all watchlist entries                   |
| POST   | `/api/watchlist`                | Add a watchlist entry                       |
| DELETE | `/api/watchlist/:id`            | Delete a watchlist entry                    |

---

## 6. Troubleshooting

### "Google OAuth is not configured"
→ Make sure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`.

### "No refresh token found for the user"
→ You haven't completed the OAuth flow yet. Visit `http://localhost:3001/auth/google` to authenticate.

### Token expired / "Invalid Credentials"
→ The backend automatically refreshes the access token using the stored refresh token. If the refresh token was revoked (e.g., you changed your password or removed the app from your Google account), re-authenticate by visiting `http://localhost:3001/auth/google`.

### "MONGODB_URI is not defined"
→ Ensure `MONGODB_URI` is set in `.env` and points to a running MongoDB instance.

### Port already in use
→ Change the backend port by setting `PORT=3002` in `.env`. Update `GOOGLE_REDIRECT_URI` and any Google Cloud OAuth configuration to match the new port.

---

## 7. Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Frontend   | React 19, Vite, Tailwind CSS, Recharts  |
| Backend    | Express.js, Node.js                     |
| Database   | MongoDB (via `mongodb` native driver)   |
| Auth       | Google OAuth 2.0 (`googleapis` library) |
| Scheduling | `node-cron` (prunes old archived messages every 4 hours) |