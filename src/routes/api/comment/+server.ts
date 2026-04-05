import { json, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';

export async function POST({ request, locals }) {
	if (!locals.session) {
		throw redirect(302, '/auth/slack');
	}

	const { id, comment } = (await request.json()) as { id?: unknown; comment?: unknown };
	if (typeof id !== 'number' || typeof comment !== 'string') {
		return json({ error: 'id (number) and comment (string) are required' }, { status: 400 });
	}

	await db.execute({
		sql: 'UPDATE requests SET comment = ? WHERE id = ?',
		args: [comment.trim() || null, id],
	});

	return json({ success: true });
}