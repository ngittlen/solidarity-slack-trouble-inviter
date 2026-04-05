import { createClient, type Client, type InStatement } from '@libsql/client';
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from './env.js';

export interface SessionData {
	slackUserId: string;
}

// Lazily initialized — created on first call to getDb() so createClient()
// is never called at build time when env vars are absent.
let _db: Client | null = null;

export function getDb(): Client {
	if (!_db) {
		_db = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
	}
	return _db;
}

// Convenience export for direct use in route handlers.
export const db = {
	execute: (stmt: InStatement) => getDb().execute(stmt),
};

// Schema init — called from hooks.server.ts init() at server startup.
export async function initDbSchema(): Promise<void> {
	const client = getDb();
	await client.execute(`
    CREATE TABLE IF NOT EXISTS requests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT UNIQUE,
      name         TEXT,
      phone        TEXT,
      comment      TEXT,
      requested_at TEXT NOT NULL
    )
  `);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
}

// --- Session store ---

export class TursoStore {
	async get(sid: string): Promise<SessionData | null> {
		try {
			const result = await getDb().execute({
				sql: 'SELECT data, expires_at FROM sessions WHERE sid = ?',
				args: [sid],
			});
			if (result.rows.length === 0) return null;
			const row = result.rows[0]!;
			if (new Date(row['expires_at'] as string) < new Date()) {
				await this.destroy(sid);
				return null;
			}
			return JSON.parse(row['data'] as string) as SessionData;
		} catch {
			return null;
		}
	}

	async set(sid: string, data: SessionData, maxAgeSeconds: number): Promise<void> {
		const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
		await getDb().execute({
			sql: 'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)',
			args: [sid, JSON.stringify(data), expiresAt],
		});
	}

	async destroy(sid: string): Promise<void> {
		await getDb().execute({
			sql: 'DELETE FROM sessions WHERE sid = ?',
			args: [sid],
		});
	}
}

export const sessionStore = new TursoStore();