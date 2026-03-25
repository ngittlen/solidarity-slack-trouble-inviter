import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
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

// --- Types ---

interface WebhookBody {
  email?: unknown;
}

// --- Express app ---

const app = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post('/webhook', async (req: Request, res: Response) => {
  // Auth check
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // Validate body
  const body = req.body as WebhookBody;
  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    res.status(400).json({ error: 'Missing or invalid email' });
    return;
  }

  const email = body.email.trim();

  // Post to tracking channel
  try {
    await slack.chat.postMessage({
      channel: SLACK_TRACKING_CHANNEL_ID,
      text: `Volunteer needs help joining Slack: ${email}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:wave: A volunteer needs help joining Slack: \`${email}\``,
          },
        },
      ],
    });
    console.log(`[webhook] posted to channel for ${email}`);
  } catch (err) {
    console.error(`[webhook] failed to post for ${email}:`, err);
    res.status(502).json({ error: 'Failed to post to Slack' });
    return;
  }

  res.json({ success: true, email });
});

// Handle malformed JSON from express.json()
app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`solidarity-slack-trouble-inviter listening on port ${PORT}`);
});