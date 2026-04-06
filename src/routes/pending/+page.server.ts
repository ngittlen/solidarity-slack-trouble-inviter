import { redirect } from '@sveltejs/kit';

export function load({ locals }) {
	if (!locals.session) {
		throw redirect(302, '/auth/slack');
	}
	return { userName: locals.session.slackUserName };
}