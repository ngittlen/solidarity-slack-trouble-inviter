import { describe, it, expect, vi } from 'vitest';
import { subscribe, notifyNewRequest, notifyHelped, notifyComment } from './events.js';

// --- Tests ---

describe('events', () => {
	const newEntry = { id: 1, email: 'a@example.com', name: 'Alice', phone: null };

	it('delivers broadcast to a subscriber', () => {
		const send = vi.fn();
		const unsub = subscribe(send);
		notifyNewRequest(newEntry);
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'new-request', ...newEntry }),
		);
		unsub();
	});

	it('delivers to multiple subscribers', () => {
		const a = vi.fn();
		const b = vi.fn();
		const unsubA = subscribe(a);
		const unsubB = subscribe(b);
		notifyNewRequest(newEntry);
		expect(a).toHaveBeenCalledOnce();
		expect(b).toHaveBeenCalledOnce();
		unsubA();
		unsubB();
	});

	it('stops delivering after unsubscribe', () => {
		const send = vi.fn();
		const unsub = subscribe(send);
		unsub();
		notifyNewRequest(newEntry);
		expect(send).not.toHaveBeenCalled();
	});

	it('notifyHelped sends correct JSON', () => {
		const send = vi.fn();
		const unsub = subscribe(send);
		notifyHelped(7, true, 'Alice');
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'helped', id: 7, helped: true, editedBy: 'Alice' }),
		);
		unsub();
	});

	it('notifyComment sends correct JSON', () => {
		const send = vi.fn();
		const unsub = subscribe(send);
		notifyComment(4, 'Called back', 'Bob');
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'comment', id: 4, comment: 'Called back', editedBy: 'Bob' }),
		);
		unsub();
	});

	it('notifyComment sends null comment correctly', () => {
		const send = vi.fn();
		const unsub = subscribe(send);
		notifyComment(4, null, 'Bob');
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'comment', id: 4, comment: null, editedBy: 'Bob' }),
		);
		unsub();
	});
});