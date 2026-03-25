# solidarity-slack-trouble-inviter

A small webhook server that receives notifications from solidarity.tech when a volunteer has trouble joining Slack, and posts their email to a Slack channel so an admin can manually send them an invite.

## How it works

1. A volunteer indicates they need help joining Slack in a solidarity.tech automation
2. The automation POSTs to this server with the volunteer's email
3. The server posts a message to a configured Slack channel with the email address

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add the bot scope: `chat:write`
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (`xoxb-...`)
5. Invite the bot to your tracking channel: `/invite @your-bot-name`

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_TRACKING_CHANNEL_ID=C012AB3CD
PORT=3000
WEBHOOK_SECRET=optional-secret
```

To find your channel ID: right-click the channel in Slack → **View channel details** → scroll to the bottom.

### 3. Run the server

```bash
npm install

# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## Webhook API

### `POST /webhook`

Called by solidarity.tech when a volunteer needs help joining Slack.

**Request body:**
```json
{ "email": "volunteer@example.com" }
```

**Response:**
```json
{ "success": true, "email": "volunteer@example.com" }
```

**Optional auth:** If `WEBHOOK_SECRET` is set, include the header:
```
Authorization: Bearer your-secret-here
```

### `GET /health`

Returns `{ "status": "ok" }`. Useful for uptime monitoring.

## Deployment

[Railway](https://railway.app) is the easiest option — connect your GitHub repo, set the environment variables in the dashboard, and it deploys automatically. Use the resulting URL as the webhook endpoint in solidarity.tech.