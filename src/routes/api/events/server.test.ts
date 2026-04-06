import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server.js';

const mockSubscribe = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/events', () => ({ subscribe: mockSubscribe }));

// --- Helpers ---

const authed = { locals: { session: { slackUserId: 'U123' } } };
const unauthed = { locals: { session: null } };

// --- Tests ---

describe('GET /api/events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		mockSubscribe.mockReturnValue(vi.fn()); // default unsub fn
	});

	it('redirects to /auth/slack when not authenticated', () => {
		expect(() => GET(unauthed as never)).toThrow();
		// SvelteKit redirect() throws — verify subscribe was never called
		expect(mockSubscribe).not.toHaveBeenCalled();
	});

	it('returns a text/event-stream response', () => {
		const res = GET(authed as never) as Response;
		expect(res.headers.get('Content-Type')).toBe('text/event-stream');
		expect(res.headers.get('Cache-Control')).toBe('no-cache');
	});

	it('calls subscribe and registers a sender', () => {
		GET(authed as never);
		expect(mockSubscribe).toHaveBeenCalledOnce();
		expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function));
	});

	it('forwards broadcast events to the stream', async () => {
		let capturedSend: (data: string) => void = () => {};
		mockSubscribe.mockImplementation((send) => {
			capturedSend = send;
			return vi.fn();
		});

		const res = GET(authed as never) as Response;
		const reader = res.body!.getReader();

		capturedSend('new-request');

		const { value } = await reader.read();
		expect(value).toBe('data: new-request\n\n');

		await reader.cancel();
	});

	it('calls unsubscribe when the stream is cancelled', async () => {
		const mockUnsub = vi.fn();
		mockSubscribe.mockReturnValue(mockUnsub);

		const res = GET(authed as never) as Response;
		const reader = res.body!.getReader();
		await reader.cancel();

		expect(mockUnsub).toHaveBeenCalledOnce();
	});

	it('clears the keep-alive interval when the stream is cancelled', async () => {
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

		const res = GET(authed as never) as Response;
		const reader = res.body!.getReader();
		await reader.cancel();

		expect(clearIntervalSpy).toHaveBeenCalledOnce();
	});

	it('keep-alive interval is registered then cleared on cancel', async () => {
		// Verify setInterval is called during stream start and clearInterval on cancel.
		// This ensures the interval cannot fire after the stream closes (the crash scenario).
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

		const res = GET(authed as never) as Response;
		expect(setIntervalSpy).toHaveBeenCalledOnce();
		const timerId = setIntervalSpy.mock.results[0].value;

		const reader = res.body!.getReader();
		await reader.cancel();

		expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
	});
});