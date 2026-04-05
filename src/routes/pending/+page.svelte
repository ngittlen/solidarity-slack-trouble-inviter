<script lang="ts">
	import { onMount } from 'svelte';
	import './pending.css';

	interface Entry {
		id: number;
		email: string | null;
		name: string | null;
		phone: string | null;
		comment: string | null;
	}

	interface ApiResponse {
		pending: Entry[];
		total_requested: number;
		total_pending: number;
	}

	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let data = $state<ApiResponse | null>(null);

	let comments = $state<Record<number, string>>({});
	let saveStatuses = $state<Record<number, SaveStatus>>({});

	async function fetchPending() {
		loading = true;
		errorMessage = null;
		try {
			const res = await fetch('/api/pending');
			if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
			const json: ApiResponse = await res.json();
			data = json;
			// Initialize comment text areas with existing comments
			const newComments: Record<number, string> = {};
			for (const entry of json.pending) {
				newComments[entry.id] = entry.comment ?? '';
			}
			comments = newComments;
			saveStatuses = {};
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	async function saveComment(id: number) {
		saveStatuses[id] = 'saving';
		try {
			const res = await fetch('/api/comment', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, comment: comments[id] ?? '' })
			});
			if (!res.ok) throw new Error(`Save failed: ${res.status}`);
			saveStatuses[id] = 'saved';
			setTimeout(() => {
				saveStatuses[id] = 'idle';
			}, 2000);
		} catch {
			saveStatuses[id] = 'error';
		}
	}

	function getSaveLabel(id: number): string {
		const status = saveStatuses[id] ?? 'idle';
		if (status === 'saving') return '...';
		if (status === 'saved') return 'Saved';
		if (status === 'error') return 'Error';
		return 'Save';
	}

	onMount(() => {
		fetchPending();
	});
</script>

<header>
	<h1>Slack Invite Queue</h1>
	<a href="/auth/logout">Log out</a>
</header>

<main>
	{#if loading}
		<p class="status">Loading...</p>
	{:else if errorMessage}
		<p class="error">{errorMessage}</p>
	{:else if data}
		<div class="stats">
			<div class="stat">
				<div class="stat-value">{data.total_pending}</div>
				<div class="stat-label">Pending</div>
			</div>
			<div class="stat">
				<div class="stat-value">{data.total_requested}</div>
				<div class="stat-label">Total requested</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>Pending Invites</h2>
				<button onclick={fetchPending}>Refresh</button>
			</div>

			{#if data.pending.length === 0}
				<p class="empty">No pending invites.</p>
			{:else}
				<ul>
					{#each data.pending as entry (entry.id)}
						<li>
							<div class="entry-name">
								{entry.name ?? entry.email ?? entry.phone ?? '(unknown)'}
							</div>
							<div class="entry-meta">
								{#if entry.email && entry.phone}
									<a href="mailto:{entry.email}">{entry.email}</a>
									·
									<a href="tel:{entry.phone}">{entry.phone}</a>
								{:else if entry.email}
									<a href="mailto:{entry.email}">{entry.email}</a>
								{:else if entry.phone}
									<a href="tel:{entry.phone}">{entry.phone}</a>
								{/if}
							</div>
							<div class="comment-row">
								<textarea
									placeholder="Add a comment..."
									bind:value={comments[entry.id]}
								></textarea>
								<button
									class="save-btn"
									class:saved={saveStatuses[entry.id] === 'saved'}
									disabled={saveStatuses[entry.id] === 'saving'}
									onclick={() => saveComment(entry.id)}
								>
									{getSaveLabel(entry.id)}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</main>