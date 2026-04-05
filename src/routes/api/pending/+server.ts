import { json, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { slack } from '$lib/server/slack.js';

export async function GET({ locals }) {
	if (!locals.session) {
		throw redirect(302, '/auth/slack');
	}

	const result = await db.execute(`
    SELECT id, email, name, phone, comment FROM requests ORDER BY email ASC
  `);

	if (result.rows.length === 0) {
		return json({ pending: [], total_requested: 0, total_pending: 0 });
	}

	const rows = result.rows.map((r) => ({
		id: r['id'] as number,
		email: (r['email'] as string | null) ?? null,
		name: (r['name'] as string | null) ?? null,
		phone: (r['phone'] as string | null) ?? null,
		comment: (r['comment'] as string | null) ?? null,
	}));

	// Fetch Slack member emails to check who has already joined
	const slackEmails = new Set<string>();
	let cursor: string | undefined;

	do {
		const page = await slack.users.list({ limit: 200, cursor });
		for (const user of page.members ?? []) {
			if (!user.deleted && !user.is_bot && user.profile?.email) {
				slackEmails.add(user.profile.email.toLowerCase());
			}
		}
		cursor = page.response_metadata?.next_cursor;
	} while (cursor);

	// Records without an email can't be checked against Slack — always include them
	const pending = rows.filter(
		({ email }) => email === null || !slackEmails.has(email.toLowerCase()),
	);

	return json({ pending, total_requested: rows.length, total_pending: pending.length });
}