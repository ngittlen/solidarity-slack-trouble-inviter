// In-memory SSE subscriber registry.
// Shared across all server-side imports within the same process.

type Sender = (data: string) => void;

const subscribers = new Set<Sender>();

export function subscribe(send: Sender): () => void {
	subscribers.add(send);
	return () => subscribers.delete(send);
}

function broadcast(data: string) {
	for (const send of subscribers) {
		send(data);
	}
}

export function notifyNewRequest(entry: {
	id: number;
	email: string | null;
	name: string | null;
	phone: string | null;
}) {
	broadcast(JSON.stringify({ type: 'new-request', ...entry }));
}

export function notifyHelped(id: number, helped: boolean, editedBy: string) {
	broadcast(JSON.stringify({ type: 'helped', id, helped, editedBy }));
}

export function notifyComment(id: number, comment: string | null, editedBy: string) {
	broadcast(JSON.stringify({ type: 'comment', id, comment, editedBy }));
}