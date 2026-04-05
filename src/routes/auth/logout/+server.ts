import { sessionStore } from '$lib/server/db.js';

export async function GET({ cookies }) {
	const sid = cookies.get('session');
	if (sid) {
		await sessionStore.destroy(sid);
	}
	cookies.delete('session', { path: '/' });
	return new Response('Logged out.');
}