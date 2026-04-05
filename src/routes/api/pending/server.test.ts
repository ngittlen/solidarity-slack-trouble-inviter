import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server.js';

const mockExecute = vi.hoisted(() => vi.fn());
const mockUsersList = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({ db: { execute: mockExecute } }));
vi.mock('$lib/server/slack', () => ({ slack: { users: { list: mockUsersList } } }));

// --- Helpers ---

const authed = { locals: { session: { slackUserId: 'U123' } } };
const unauthed = { locals: { session: null } };

function slackPage(emails: string[], nextCursor = '') {
	return {
		members: emails.map((email) => ({ deleted: false, is_bot: false, profile: { email } })),
		response_metadata: { next_cursor: nextCursor },
	};
}

// --- Tests ---

describe('GET /api/pending', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUsersList.mockResolvedValue(slackPage([]));
	});

	it('redirects to /auth/slack when not authenticated', async () => {
		await expect(GET(unauthed as never)).rejects.toMatchObject({
			status: 302,
			location: '/auth/slack',
		});
	});

	it('returns empty result when there are no requests', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const res = await GET(authed as never);
		expect(await res.json()).toEqual({ pending: [], total_requested: 0, total_pending: 0 });
	});

	it('includes all rows when none have joined Slack', async () => {
		mockExecute.mockResolvedValue({
			rows: [
				{ id: 1, email: 'a@example.com', name: 'Alice', phone: null, comment: null },
				{ id: 2, email: 'b@example.com', name: 'Bob', phone: null, comment: null },
			],
		});
		const json = await (await GET(authed as never)).json();
		expect(json.total_requested).toBe(2);
		expect(json.total_pending).toBe(2);
	});

	it('filters out rows whose email is already in Slack', async () => {
		mockExecute.mockResolvedValue({
			rows: [
				{ id: 1, email: 'joined@example.com', name: 'Alice', phone: null, comment: null },
				{ id: 2, email: 'pending@example.com', name: 'Bob', phone: null, comment: null },
			],
		});
		mockUsersList.mockResolvedValue(slackPage(['joined@example.com']));

		const json = await (await GET(authed as never)).json();
		expect(json.total_requested).toBe(2);
		expect(json.total_pending).toBe(1);
		expect(json.pending[0].email).toBe('pending@example.com');
	});

	it('email comparison is case-insensitive', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ id: 1, email: 'User@Example.COM', name: null, phone: null, comment: null }],
		});
		mockUsersList.mockResolvedValue(slackPage(['user@example.com']));

		const json = await (await GET(authed as never)).json();
		expect(json.total_pending).toBe(0);
	});

	it('always includes phone-only rows (no email to match against Slack)', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ id: 1, email: null, name: 'Phone User', phone: '555-1234', comment: null }],
		});
		mockUsersList.mockResolvedValue(slackPage(['anyone@example.com']));

		const json = await (await GET(authed as never)).json();
		expect(json.total_pending).toBe(1);
	});

	it('paginates through Slack member pages using cursor', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ id: 1, email: 'a@example.com', name: null, phone: null, comment: null }],
		});
		mockUsersList
			.mockResolvedValueOnce(slackPage(['page1@example.com'], 'cursor1'))
			.mockResolvedValueOnce(slackPage(['page2@example.com'], ''));

		await GET(authed as never);
		expect(mockUsersList).toHaveBeenCalledTimes(2);
		expect(mockUsersList).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cursor: 'cursor1' }),
		);
	});
});