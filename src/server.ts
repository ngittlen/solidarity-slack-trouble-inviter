import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import session, { Store, SessionData } from 'express-session';
import { WebClient } from '@slack/web-api';
import { createClient, type Client } from '@libsql/client';

// --- Env validation ---

const REQUIRED_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_ALLOWED_USER_IDS',
  'SLACK_TRACKING_CHANNEL_ID',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'WEBHOOK_SECRET',
  'SESSION_SECRET',
  'APP_URL',
] as const;

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const SLACK_BOT_TOKEN = process.env['SLACK_BOT_TOKEN']!;
const SLACK_CLIENT_ID = process.env['SLACK_CLIENT_ID']!;
const SLACK_CLIENT_SECRET = process.env['SLACK_CLIENT_SECRET']!;
const SLACK_ALLOWED_USER_IDS = new Set(
  process.env['SLACK_ALLOWED_USER_IDS']!.split(',').map((id) => id.trim()),
);
const SLACK_TRACKING_CHANNEL_ID = process.env['SLACK_TRACKING_CHANNEL_ID']!;
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET']!;
const SESSION_SECRET = process.env['SESSION_SECRET']!;
const APP_URL = process.env['APP_URL']!;
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const REDIRECT_URI = `${APP_URL}/auth/slack/callback`;

// --- Type augmentation ---

declare module 'express-session' {
  interface SessionData {
    slackUserId: string;
    oauthState: string;
  }
}

// --- Slack API response types ---

interface SlackOAuthResponse {
  ok: boolean;
  authed_user?: { access_token: string };
  error?: string;
}

interface SlackIdentityResponse {
  ok: boolean;
  user?: { id: string; name: string };
  error?: string;
}

// --- Clients ---

const slack = new WebClient(SLACK_BOT_TOKEN);

const db = createClient({
  url: process.env['TURSO_DATABASE_URL']!,
  authToken: process.env['TURSO_AUTH_TOKEN']!,
});

// --- Turso session store ---

class TursoStore extends Store {
  constructor(private readonly client: Client) {
    super();
  }

  async get(sid: string, callback: (err: unknown, session?: SessionData | null) => void) {
    try {
      const result = await this.client.execute({
        sql: 'SELECT data, expires_at FROM sessions WHERE sid = ?',
        args: [sid],
      });
      if (result.rows.length === 0) return callback(null, null);
      const row = result.rows[0]!;
      if (new Date(row['expires_at'] as string) < new Date()) {
        await this.destroy(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row['data'] as string) as SessionData);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid: string, session: SessionData, callback?: (err?: unknown) => void) {
    try {
      const maxAge = session.cookie.maxAge ?? 8 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + maxAge).toISOString();
      await this.client.execute({
        sql: 'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)',
        args: [sid, JSON.stringify(session), expiresAt],
      });
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: unknown) => void) {
    try {
      await this.client.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] });
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}

// --- DB setup ---

await db.execute(`
  CREATE TABLE IF NOT EXISTS requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL UNIQUE,
    name         TEXT,
    phone        TEXT,
    requested_at TEXT NOT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

// --- Express app ---

const app = express();
app.set('trust proxy', 1);

app.use(
  session({
    store: new TursoStore(db),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  }),
);

// --- Auth middleware ---

function requireAuth(req: Request, res: Response, next: () => void) {
  if (req.session.slackUserId) {
    next();
    return;
  }
  res.redirect('/auth/slack');
}

// --- Routes ---

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Step 1: redirect to Slack OAuth
app.get('/auth/slack', (req: Request, res: Response) => {
  const state = crypto.randomUUID();
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    user_scope: 'identity.basic',
    redirect_uri: REDIRECT_URI,
    state,
  });

  req.session.save(() => {
    res.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
  });
});

// Step 2: handle Slack OAuth callback
app.get('/auth/slack/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[auth] Slack OAuth error:', error);
    res.status(403).send('Access denied.');
    return;
  }

  if (!code || state !== req.session.oauthState) {
    res.status(400).send('Invalid OAuth state.');
    return;
  }

  // Exchange code for token
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: code as string,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const tokenData = (await tokenRes.json()) as SlackOAuthResponse;
  if (!tokenData.ok || !tokenData.authed_user?.access_token) {
    console.error('[auth] token exchange failed:', tokenData.error);
    res.status(502).send('Authentication failed.');
    return;
  }

  // Get user identity
  const identityRes = await fetch('https://slack.com/api/users.identity', {
    headers: { Authorization: `Bearer ${tokenData.authed_user.access_token}` },
  });

  const identity = (await identityRes.json()) as SlackIdentityResponse;
  if (!identity.ok || !identity.user?.id) {
    console.error('[auth] identity fetch failed:', identity.error);
    res.status(502).send('Authentication failed.');
    return;
  }

  const userId = identity.user.id;
  if (!SLACK_ALLOWED_USER_IDS.has(userId)) {
    console.warn(`[auth] blocked user: ${userId} (${identity.user.name})`);
    res.status(403).send('You are not authorised to view this page.');
    return;
  }

  delete req.session.oauthState;
  req.session.slackUserId = userId;
  console.log(`[auth] login: ${identity.user.name} (${userId})`);
  res.redirect('/pending');
});

app.get('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.send('Logged out.'));
});

// Webhook — called by solidarity.tech automation
app.get('/webhook', async (req: Request, res: Response) => {
  if (req.query['secret'] !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { email, name, phone } = req.query;
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Missing or invalid email' });
    console.log(`[webhook] missing or invalid email: ${email}`);
    return;
  }

  const trimmedEmail = email.trim();
  const trimmedName = typeof name === 'string' ? name.trim() || null : null;
  const trimmedPhone = typeof phone === 'string' ? phone.trim() || null : null;

  await db.execute({
    sql: 'INSERT OR REPLACE INTO requests (email, name, phone, requested_at) VALUES (?, ?, ?, ?)',
    args: [trimmedEmail, trimmedName, trimmedPhone, new Date().toISOString()],
  });

  const details = [
    trimmedName,
    trimmedPhone ? `📞 ${trimmedPhone}` : null,
    `\`${trimmedEmail}\``,
  ].filter(Boolean).join('  ·  ');

  try {
    await slack.chat.postMessage({
      channel: SLACK_TRACKING_CHANNEL_ID,
      text: `Volunteer needs help joining Slack: ${trimmedEmail}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:wave: A volunteer needs help joining Slack: ${details}`,
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

// Pending — HTML page for admins
app.get('/pending', requireAuth, (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slack Invite Queue</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; color: #1a1a1a; }
    header { background: #fff; border-bottom: 1px solid #e0e0e0; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 1.1rem; font-weight: 600; }
    header a { font-size: 0.85rem; color: #666; text-decoration: none; }
    header a:hover { color: #1a1a1a; }
    main { max-width: 640px; margin: 40px auto; padding: 0 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px 20px; flex: 1; }
    .stat-value { font-size: 2rem; font-weight: 700; line-height: 1; }
    .stat-label { font-size: 0.8rem; color: #666; margin-top: 4px; }
    .card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .card-header h2 { font-size: 0.9rem; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    button { background: #1a1a1a; color: #fff; border: none; border-radius: 6px; padding: 7px 14px; font-size: 0.85rem; cursor: pointer; }
    button:hover { background: #333; }
    ul { list-style: none; }
    li { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    li:last-child { border-bottom: none; }
    .entry-name { font-size: 0.95rem; font-weight: 500; }
    .entry-meta { font-size: 0.8rem; color: #666; margin-top: 2px; }
    .entry-meta a { color: #666; text-decoration: none; }
    .entry-meta a:hover { text-decoration: underline; }
    .empty { color: #999; font-size: 0.9rem; padding: 8px 0; }
    .status { color: #999; font-size: 0.9rem; padding: 8px 0; }
    .error { color: #c0392b; font-size: 0.9rem; padding: 8px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Slack Invite Queue</h1>
    <a href="/auth/logout">Log out</a>
  </header>
  <main>
    <div class="stats">
      <div class="stat"><div class="stat-value" id="total-pending">—</div><div class="stat-label">Pending</div></div>
      <div class="stat"><div class="stat-value" id="total-requested">—</div><div class="stat-label">Total requested</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>Pending requests</h2>
        <button id="refresh-btn">Refresh</button>
      </div>
      <ul id="list"><li class="status">Loading...</li></ul>
    </div>
  </main>
  <script>
    async function load() {
      const list = document.getElementById('list');
      list.innerHTML = '<li class="status">Loading...</li>';
      try {
        const res = await fetch('/api/pending');
        if (!res.ok) {
          list.innerHTML = '<li class="error">Failed to load data. Try refreshing.</li>';
          return;
        }
        const data = await res.json();
        document.getElementById('total-pending').textContent = data.total_pending;
        document.getElementById('total-requested').textContent = data.total_requested;
        if (data.pending.length === 0) {
          list.innerHTML = '<li class="empty">No pending requests.</li>';
        } else {
          list.innerHTML = data.pending.map(({ email, name, phone }) => {
            const meta = [
              \`<a href="mailto:\${email}">\${email}</a>\`,
              phone ? \`<a href="tel:\${phone}">\${phone}</a>\` : null,
            ].filter(Boolean).join('  ·  ');
            return \`<li>
              <div class="entry-name">\${name ?? email}</div>
              <div class="entry-meta">\${name ? meta : (phone ? \`<a href="tel:\${phone}">\${phone}</a>\` : '')}</div>
            </li>\`;
          }).join('');
        }
      } catch (err) {
        list.innerHTML = '<li class="error">Failed to load data. Try refreshing.</li>';
      }
    }
    document.getElementById('refresh-btn').addEventListener('click', load);
    load();
  </script>
</body>
</html>`);
});

// Pending API — returns JSON for the HTML page above
app.get('/api/pending', requireAuth, async (_req: Request, res: Response) => {
  const result = await db.execute(`
    SELECT email, name, phone FROM requests ORDER BY email ASC
  `);

  if (result.rows.length === 0) {
    res.json({ pending: [], total_requested: 0, total_pending: 0 });
    return;
  }

  const requestedByEmail = new Map(
    result.rows.map((r) => [
      r['email'] as string,
      { name: (r['name'] as string | null) ?? null, phone: (r['phone'] as string | null) ?? null },
    ]),
  );

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

  const pending = [...requestedByEmail.entries()]
    .filter(([email]) => !slackEmails.has(email.toLowerCase()))
    .map(([email, { name, phone }]) => ({ email, name, phone }));

  res.json({ pending, total_requested: requestedByEmail.size, total_pending: pending.length });
});

app.listen(PORT, () => {
  console.log(`solidarity-slack-trouble-inviter listening on port ${PORT}`);
});