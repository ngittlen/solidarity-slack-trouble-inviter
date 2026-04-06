import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db.js';
import { notifyComment } from '$lib/server/events.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session) {
		throw redirect(302, '/auth/slack');
	}

	const { id, comment } = (await request.json()) as { id?: unknown; comment?: unknown };
	if (typeof id !== 'number' || typeof comment !== 'string') {
		return json({ error: 'id (number) and comment (string) are required' }, { status: 400 });
	}

	const trimmedComment = comment.trim() || null;
	const editorName = locals.session.slackUserName ?? locals.session.slackUserId;

	await db.execute({
		sql: 'UPDATE requests SET comment = ?, last_edited_by_id = ?, last_edited_by_name = ? WHERE id = ?',
		args: [trimmedComment, locals.session.slackUserId, editorName, id],
	});

	notifyComment(id, trimmedComment, editorName);

	return json({ success: true });
}