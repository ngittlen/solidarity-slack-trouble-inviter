import { json, redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db.js';
import { notifyHelped } from '$lib/server/events.js';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.session) {
		redirect(302, '/auth/slack');
	}

	const body = await request.json();
	if (typeof body.id !== 'number' || typeof body.helped !== 'boolean') {
		error(400, 'Invalid request body');
	}

	const editorName = locals.session!.slackUserName ?? locals.session!.slackUserId;

	await db.execute({
		sql: 'UPDATE requests SET helped = ?, last_edited_by_id = ?, last_edited_by_name = ? WHERE id = ?',
		args: [body.helped ? 1 : 0, locals.session!.slackUserId, editorName, body.id],
	});

	notifyHelped(body.id, body.helped, editorName);

	return json({ success: true });
};