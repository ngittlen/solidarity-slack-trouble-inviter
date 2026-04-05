import type { Handle } from '@sveltejs/kit';
import { sessionStore, initDbSchema } from '$lib/server/db.js';
import { validateEnv } from '$lib/server/env.js';

// Runs once when the server starts — before handling any requests.
export async function init() {
	validateEnv();
	await initDbSchema();
}

export const handle: Handle = async ({ event, resolve }) => {
	const sid = event.cookies.get('session');

	if (sid) {
		const sessionData = await sessionStore.get(sid);
		if (sessionData) {
			event.locals.session = sessionData;
			// Refresh cookie expiry on active use
			event.cookies.set('session', sid, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 8 * 60 * 60,
			});
		} else {
			event.locals.session = null;
			event.cookies.delete('session', { path: '/' });
		}
	} else {
		event.locals.session = null;
	}

	return resolve(event);
};