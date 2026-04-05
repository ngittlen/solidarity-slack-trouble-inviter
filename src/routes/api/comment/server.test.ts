import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server.js';

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/db', () => ({ db: { execute: mockExecute } }));

// --- Helpers ---

const authed = { locals: { session: { slackUserId: 'U123' } } };
const unauthed = { locals: { session: null } };

function makeEvent(session: typeof authed | typeof unauthed, body: unknown) {
	return {
		...session,
		request: { json: async () => body } as Request,
	};
}

// --- Tests ---

describe('POST /api/comment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue({});
	});

	it('redirects to /auth/slack when not authenticated', async () => {
		await expect(
			POST(makeEvent(unauthed, { id: 1, comment: 'hi' }) as never),
		).rejects.toMatchObject({ status: 302, location: '/auth/slack' });
	});

	it('returns 400 when id is missing', async () => {
		const res = await POST(makeEvent(authed, { comment: 'hi' }) as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('id') });
	});

	it('returns 400 when comment is not a string', async () => {
		const res = await POST(makeEvent(authed, { id: 1, comment: 42 }) as never);
		expect(res.status).toBe(400);
	});

	it('returns 400 when id is a string instead of number', async () => {
		const res = await POST(makeEvent(authed, { id: '1', comment: 'hi' }) as never);
		expect(res.status).toBe(400);
	});

	it('saves comment and returns success', async () => {
		const res = await POST(makeEvent(authed, { id: 5, comment: 'called' }) as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });
		expect(mockExecute).toHaveBeenCalledWith(
			expect.objectContaining({ args: expect.arrayContaining(['called', 5]) }),
		);
	});

	it('stores null when comment is blank whitespace', async () => {
		await POST(makeEvent(authed, { id: 5, comment: '   ' }) as never);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.objectContaining({ args: [null, 5] }),
		);
	});
});