# solidarity-slack-trouble-inviter

A small webhook server that receives notifications from solidarity.tech when a volunteer has trouble joining Slack, records their email, and posts it to a Slack channel so an admin can manually send them an invite. A `/pending` endpoint shows which volunteers still haven't joined.

## How it works

1. A volunteer indicates they need help joining Slack in a solidarity.tech automation
2. The automation calls `GET /webhook?secret=<WEBHOOK_SECRET>&email=<volunteer_email>`
3. The server stores the email in a Turso database and posts a message to a Slack channel
4. `GET /pending?secret=<WEBHOOK_SECRET>` compares stored emails against current Slack workspace members and returns anyone who still hasn't joined

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add these bot scopes:
   - `chat:write` — to post messages
   - `users:read` — to list workspace members
   - `users:read.email` — to read member email addresses
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (`xoxb-...`)
5. Invite the bot to your tracking channel: `/invite @your-bot-name`

### 2. Create a Turso database

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

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_TRACKING_CHANNEL_ID=C012AB3CD
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-auth-token-here
WEBHOOK_SECRET=your-secret-here
PORT=3000
```

To find your channel ID: right-click the channel in Slack → **View channel details** → scroll to the bottom.

### 4. Run the server

```bash
npm install

# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## API

### `GET /webhook?secret=<WEBHOOK_SECRET>&email=<USER_EMAIL>`

Called by solidarity.tech when a volunteer needs help joining Slack. Stores the email and posts to the tracking channel. Returns `401` if the secret is missing or incorrect.

### `GET /pending?secret=<WEBHOOK_SECRET>`

Returns all email addresses that have requested help but still haven't joined the Slack workspace. Returns `401` if the secret is missing or incorrect.

**Example response:**
```json
{
  "pending": ["volunteer@example.com"],
  "total_requested": 5,
  "total_pending": 1
}
```

### `GET /health`

Returns `{ "status": "ok" }`. Useful for uptime monitoring.

## Deployment

[Railway](https://railway.app) is the easiest option — connect your GitHub repo, set the environment variables in the dashboard, and it deploys automatically. Use the resulting URL as the webhook endpoint in solidarity.tech.