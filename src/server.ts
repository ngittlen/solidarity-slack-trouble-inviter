import 'dotenv/config';
import express, { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';

// --- Env validation ---

const REQUIRED_VARS = ['SLACK_BOT_TOKEN', 'SLACK_TRACKING_CHANNEL_ID'] as const;
for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const SLACK_BOT_TOKEN = process.env['SLACK_BOT_TOKEN']!;
const SLACK_TRACKING_CHANNEL_ID = process.env['SLACK_TRACKING_CHANNEL_ID']!;
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'] || null;
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

// --- Slack client ---

const slack = new WebClient(SLACK_BOT_TOKEN);

// --- Express app ---

const app = express();

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/webhook', async (req: Request, res: Response) => {
  // Auth check
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // Validate query param
  const { email } = req.query;
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Missing or invalid email' });
    console.log(`[webhook] error posting to channel: missing or invalid email ${email}`);
    return;
  }

  const trimmedEmail = email.trim();

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


app.listen(PORT, () => {
  console.log(`solidarity-slack-trouble-inviter listening on port ${PORT}`);
});