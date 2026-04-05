# solidarity-slack-trouble-inviter

A small webhook server that receives notifications from solidarity.tech when a volunteer has trouble joining Slack, records their email, and posts it to a Slack channel so an admin can manually send them an invite. A `/pending` endpoint shows which volunteers still haven't joined, protected by Sign in with Slack.

## How it works

1. A volunteer indicates they need help joining Slack in a solidarity.tech automation
2. The automation calls `GET /webhook?secret=<WEBHOOK_SECRET>&email=<email>&name=<name>&phone=<phone>`
3. The server stores the volunteer's details in a Turso database and posts a message to a Slack channel
4. Authorised admins visit `/pending`, sign in with Slack, and see which volunteers still haven't joined

## Setup

### 1. Configure the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app (or use an existing one)
2. Under **OAuth & Permissions**, add these bot scopes:
   - `chat:write` — to post messages
   - `users:read` — to list workspace members
   - `users:read.email` — to read member email addresses
3. Under **OAuth & Permissions**, add this user scope:
   - `identity.basic` — for Sign in with Slack
4. Under **OAuth & Permissions → Redirect URLs**, add:
   ```
   https://your-app.fly.dev/auth/slack/callback
   ```
5. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-...`)
6. Invite the bot to your tracking channel: `/invite @your-bot-name`
7. Copy the **Client ID** and **Client Secret** from **Basic Information**

### 2. Find your Slack user IDs

For each person who should have access to `/pending`:
- Open their profile in Slack → **...** menu → **Copy member ID**

### 3. Create a Turso database

1. Sign up at [turso.tech](https://turso.tech) (free tier)
2. Create a new database:
   ```bash
   turso db create solidarity-slack
   ```
3. Get the connection URL and auth token:
   ```bash
   turso db show solidarity-slack --url
   turso db tokens create solidarity-slack
   ```

### 4. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_ALLOWED_USER_IDS=U012AB3CD,U012AB3CE
SLACK_TRACKING_CHANNEL_ID=C012AB3CD
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-auth-token-here
WEBHOOK_SECRET=your-webhook-secret-here
SESSION_SECRET=your-session-secret-here
APP_URL=https://your-app.fly.dev
PORT=3000  # defaults to 3000 in production; ignored in dev (Vite uses 5173)
```

### 5. Run the server

```bash
npm install

# Development (hot reload, http://localhost:5173)
npm run dev

# Run tests
npm test

# Production
npm run build
npm start
```

## Local development

A minimal `.env.local` for local development — no real Slack credentials needed:

```
TURSO_DATABASE_URL=file:local.db
WEBHOOK_SECRET=any-local-secret
SESSION_SECRET=any-local-secret
DEV_SLACK_USER_ID=U012AB3CD
```

`file:local.db` creates a local SQLite database in the project root (no Turso account needed). `DEV_SLACK_USER_ID` bypasses Slack OAuth — visiting `/pending` automatically creates a session for that user ID. Set it to your real Slack user ID so the allowlist check passes once you wire up real credentials.

## API

### `GET /webhook`

Called by solidarity.tech when a volunteer needs help joining Slack. Stores the volunteer's details and posts to the tracking channel. Returns `401` if the secret is wrong.

| Parameter | Required | Description |
|---|---|---|
| `secret` | Yes | Must match `WEBHOOK_SECRET` |
| `email` | No* | Volunteer's email address |
| `name` | No | Volunteer's full name |
| `phone` | No* | Volunteer's phone number |

\* At least one of `email` or `phone` is required.

If the same email is submitted again, the existing record is updated with the new name, phone, and timestamp.

### `GET /pending`

Protected by Slack OAuth. Redirects unauthenticated users to Sign in with Slack. Only users listed in `SLACK_ALLOWED_USER_IDS` are granted access. Displays a web page listing volunteers who have requested help but still haven't joined the workspace.

The underlying JSON is also available at `GET /api/pending`:

```json
{
  "pending": [
    { "id": 1, "email": "volunteer@example.com", "name": "Jane Smith", "phone": "555-1234", "comment": null }
  ],
  "total_requested": 5,
  "total_pending": 1
}
```

Admins can add a comment to any row directly on the page. Comments are saved via `POST /api/comment`.

### `POST /api/comment`

Saves a comment for a request. Requires an active Slack OAuth session.

```json
{ "id": 1, "comment": "Left a voicemail, waiting to hear back." }
```

### `GET /auth/slack`

Starts the Slack OAuth login flow. Redirected to automatically when visiting `/pending` without a session.

### `GET /auth/logout`

Destroys the current session.

### `GET /health`

Returns `{ "status": "ok" }`. Useful for uptime monitoring.

## Deployment

[Fly.io](https://fly.io) is the recommended hosting option. Install the CLI, run `fly launch` in the project directory, then set secrets and deploy:

```bash
fly secrets set \
  SLACK_BOT_TOKEN=xoxb-... \
  SLACK_CLIENT_ID=... \
  SLACK_CLIENT_SECRET=... \
  SLACK_ALLOWED_USER_IDS=U012AB3CD \
  SLACK_TRACKING_CHANNEL_ID=C012AB3CD \
  TURSO_DATABASE_URL=libsql://your-db.turso.io \
  TURSO_AUTH_TOKEN=... \
  WEBHOOK_SECRET=... \
  SESSION_SECRET=... \
  APP_URL=https://your-app.fly.dev \
  ORIGIN=https://your-app.fly.dev

fly deploy
```

`ORIGIN` is required by SvelteKit's adapter-node for CSRF protection — it must match the public URL of your app. Set it to the same value as `APP_URL`.

Use the resulting URL as:
- The webhook endpoint in solidarity.tech: `https://your-app.fly.dev/webhook?secret=...&email=...&name=...&phone=...`
- The redirect URL in your Slack App: `https://your-app.fly.dev/auth/slack/callback`