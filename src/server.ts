import 'dotenv/config';
import express, { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { createClient } from '@libsql/client';

// --- Env validation ---

const REQUIRED_VARS = ['SLACK_BOT_TOKEN', 'SLACK_TRACKING_CHANNEL_ID', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'WEBHOOK_SECRET'] as const;
for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const SLACK_BOT_TOKEN = process.env['SLACK_BOT_TOKEN']!;
const SLACK_TRACKING_CHANNEL_ID = process.env['SLACK_TRACKING_CHANNEL_ID']!;
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET']!;
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

// --- Clients ---

const slack = new WebClient(SLACK_BOT_TOKEN);

const db = createClient({
  url: process.env['TURSO_DATABASE_URL']!,
  authToken: process.env['TURSO_AUTH_TOKEN']!,
});

// --- DB setup ---

await db.execute(`
  CREATE TABLE IF NOT EXISTS requests (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    email   TEXT NOT NULL,
    requested_at TEXT NOT NULL
  )
`);

// --- Express app ---

const app = express();

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/webhook', async (req: Request, res: Response) => {
  // Auth check
  if (req.query['secret'] !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Validate query param
  const { email } = req.query;
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Missing or invalid email' });
    console.log(`[webhook] missing or invalid email: ${email}`);
    return;
  }

  const trimmedEmail = email.trim();

  // Store in DB
  await db.execute({
    sql: 'INSERT INTO requests (email, requested_at) VALUES (?, ?)',
    args: [trimmedEmail, new Date().toISOString()],
  });

  // Post to tracking channel
  try {
    await slack.chat.postMessage({
      channel: SLACK_TRACKING_CHANNEL_ID,
      text: `Volunteer needs help joining Slack: ${trimmedEmail}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:wave: A volunteer needs help joining Slack: \`${trimmedEmail}\``,
          },
        },
      ],
    });
    console.log(`[webhook] posted to channel for ${trimmedEmail}`);
  } catch (err) {
    console.error(`[webhook] failed to post for ${trimmedEmail}:`, err);
    res.status(502).json({ error: 'Failed to post to Slack' });
    return;
  }

  res.json({ success: true, email: trimmedEmail });
});

// Returns emails that hit the webhook but still haven't joined the Slack workspace.
// Requires the bot to have the users:read.email scope.
app.get('/pending', async (req: Request, res: Response) => {
  if (req.query['secret'] !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Fetch all emails that have requested help
  const result = await db.execute('SELECT DISTINCT email FROM requests ORDER BY email ASC');
  const requestedEmails = new Set(result.rows.map((r) => r['email'] as string));

  if (requestedEmails.size === 0) {
    res.json({ pending: [] });
    return;
  }

  // Fetch all Slack workspace member emails
  const slackEmails = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await slack.users.list({ limit: 200, cursor });
    for (const user of page.members ?? []) {
      if (!user.deleted && !user.is_bot && user.profile?.email) {
        slackEmails.add(user.profile.email.toLowerCase());
      }
    }
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);

  // Return emails that haven't joined yet
  const pending = [...requestedEmails].filter(
    (email) => !slackEmails.has(email.toLowerCase()),
  );

  res.json({ pending, total_requested: requestedEmails.size, total_pending: pending.length });
});

app.listen(PORT, () => {
  console.log(`solidarity-slack-trouble-inviter listening on port ${PORT}`);
});