import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server.js';

const mockExecute = vi.hoisted(() => vi.fn());
const mockNotifyHelped = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({ db: { execute: mockExecute } }));
vi.mock('$lib/server/events', () => ({ notifyHelped: mockNotifyHelped }));

// --- Helpers ---

const authed = {
	locals: { session: { slackUserId: 'U123', slackUserName: 'Alice' } },
};
const unauthed = { locals: { session: null } };

function makeEvent(session: typeof authed | typeof unauthed, body: unknown) {
	return { ...session, request: { json: async () => body } as Request };
}

// --- Tests ---

describe('POST /api/helped', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue({});
	});

	it('redirects to /auth/slack when not authenticated', async () => {
		await expect(
			POST(makeEvent(unauthed, { id: 1, helped: true }) as never),
		).rejects.toMatchObject({ status: 302, location: '/auth/slack' });
	});

	it('returns 400 when id is missing', async () => {
		await expect(
			POST(makeEvent(authed, { helped: true }) as never),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when helped is not a boolean', async () => {
		await expect(
			POST(makeEvent(authed, { id: 1, helped: 1 }) as never),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when id is a string', async () => {
		await expect(
			POST(makeEvent(authed, { id: '1', helped: true }) as never),
		).rejects.toMatchObject({ status: 400 });
	});

	it('marks a row as helped and returns success', async () => {
		const res = await POST(makeEvent(authed, { id: 3, helped: true }) as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });
		expect(mockExecute).toHaveBeenCalledWith(
			expect.objectContaining({ args: expect.arrayContaining([1, 3]) }),
		);
	});

	it('stores 0 in DB when helped is false', async () => {
		await POST(makeEvent(authed, { id: 3, helped: false }) as never);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.objectContaining({ args: expect.arrayContaining([0, 3]) }),
		);
	});

	it('saves the editor name alongside the helped flag', async () => {
		await POST(makeEvent(authed, { id: 3, helped: true }) as never);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.objectContaining({ args: expect.arrayContaining(['Alice', 'U123']) }),
		);
	});

	it('notifies subscribers after update', async () => {
		await POST(makeEvent(authed, { id: 3, helped: true }) as never);
		expect(mockNotifyHelped).toHaveBeenCalledWith(3, true, 'Alice');
	});
});