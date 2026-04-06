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
		sql: 'UPDATE requests SET comment = ?, last_edited_by_id = ?, last_edited_by_name = ? WHERE id = ?',
		args: [comment.trim() || null, locals.session.slackUserId, locals.session.slackUserName ?? null, id],
	});

	return json({ success: true });
}