<script lang="ts">
    import {onMount} from 'svelte';
    import './pending.css';
    import { parsePhoneNumberWithError } from 'libphonenumber-js';

    const {data: pageData} = $props();

    interface Entry {
        id: number;
        email: string | null;
        name: string | null;
        phone: string | null;
        comment: string | null;
        in_slack: boolean;
        helped: boolean;
        lastEditedById: string | null;
        lastEditedByName: string | null;
    }

    interface ApiResponse {
        pending: Entry[];
        total_requested: number;
        total_pending: number;
    }

    type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

    let loading = $state(true);
    let errorMessage = $state<string | null>(null);
    let data = $state<ApiResponse | null>(null);

    let comments = $state<Record<number, string>>({});
    let saveStatuses = $state<Record<number, SaveStatus>>({});
    let helpedState = $state<Record<number, boolean>>({});
    let lastEditedByState = $state<Record<number, string | null>>({});

    const saveTimers: Record<number, ReturnType<typeof setTimeout>> = {};

    let totalPending = $derived(
        data ? data.pending.filter((e) => !(helpedState[e.id] ?? e.helped)).length : 0
    );

    let sortedEntries = $derived(
        data
            ? [...data.pending].sort((a, b) => {
                const aHelped = helpedState[a.id] ?? a.helped;
                const bHelped = helpedState[b.id] ?? b.helped;
                if (aHelped === bHelped) return 0;
                return aHelped ? 1 : -1;
            })
            : []
    );

    async function fetchPending() {
        loading = true;
        errorMessage = null;
        try {
            const res = await fetch('/api/pending');
            if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
            const json: ApiResponse = await res.json();
            data = json;
            const newComments: Record<number, string> = {};
            const newHelped: Record<number, boolean> = {};
            for (const entry of json.pending) {
                newComments[entry.id] = entry.comment ?? '';
                newHelped[entry.id] = entry.helped;
            }
            comments = newComments;
            helpedState = newHelped;
            lastEditedByState = Object.fromEntries(json.pending.map((e) => [e.id, e.lastEditedByName]));
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
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id, comment: comments[id] ?? ''})
            });
            if (!res.ok) throw new Error(`Save failed: ${res.status}`);
            saveStatuses[id] = 'saved';
            lastEditedByState[id] = pageData.userName ?? null;
            setTimeout(() => {
                saveStatuses[id] = 'idle';
            }, 2000);
        } catch {
            saveStatuses[id] = 'error';
        }
    }

    function onCommentInput(id: number) {
        saveStatuses[id] = 'pending';
        clearTimeout(saveTimers[id]);
        saveTimers[id] = setTimeout(() => saveComment(id), 600);
    }

    async function toggleHelped(id: number) {
        const next = !(helpedState[id] ?? false);
        helpedState[id] = next;
        lastEditedByState[id] = pageData.userName ?? null;
        await fetch('/api/helped', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, helped: next})
        });
    }

    function formatPhone(phone: string): string {
        try {
            const parsed = parsePhoneNumberWithError(phone, 'US');
            return parsed.formatNational();
        } catch {
            return phone;
        }
    }

    onMount(() => {
        fetchPending();
    });
</script>

<svelte:head>
    <title>A4M Slack Invite Queue</title>
</svelte:head>

<header>
    <h1>A4M Slack Invite Queue</h1>
    <span class="user-info">
		<span>
            Logged in as <span class="user-name">{pageData.userName}</span>
        </span>
		<button class="logout-btn" onclick={() => window.location.href = '/auth/logout'}>Log out</button>
	</span>
</header>

<main>
    {#if loading}
        <p class="status">Loading...</p>
    {:else if errorMessage}
        <p class="error">{errorMessage}</p>
    {:else if data}
        <div class="toolbar">
            <div class="stats">
                <div class="stat">
                    <span class="stat-value">{totalPending}</span>
                    <span class="stat-label">Pending</span>
                </div>
                <div class="stat">
                    <span class="stat-value">{data.total_requested}</span>
                    <span class="stat-label">Total requested</span>
                </div>
            </div>
            <button onclick={fetchPending}>Refresh</button>
        </div>

        {#if data.pending.length === 0}
            <p class="empty">No pending invites.</p>
        {:else}
            <div class="table-wrap">
                <table>
                    <thead>
                    <tr>
                        <th class="col-helped"></th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Comment</th>
                        <th>Last edited by</th>
                    </tr>
                    </thead>
                    <tbody>
                    {#each sortedEntries as entry (entry.id)}
                        {@const isHelped = helpedState[entry.id] ?? entry.helped}
                        <tr class:helped={isHelped}>
                            <td class="col-helped">
                                <input
                                        type="checkbox"
                                        checked={isHelped}
                                        onchange={() => toggleHelped(entry.id)}
                                        aria-label="Mark as helped"
                                />
                            </td>
                            <td class="col-name">
                                {entry.name ?? '—'}
                                {#if entry.in_slack}
                                    <span class="in-slack-badge">Email in slack</span>
                                {/if}
                            </td>
                            <td class="col-email">
                                {#if entry.email}
                                    <a href="mailto:{entry.email}">{entry.email}</a>
                                {:else}
                                    —
                                {/if}
                            </td>
                            <td class="col-phone">
                                {#if entry.phone}
                                    <a href="tel:{entry.phone}">{formatPhone(entry.phone)}</a>
                                {:else}
                                    —
                                {/if}
                            </td>
                            <td class="col-comment">
									<textarea
                                            rows="1"
                                            placeholder="Add a comment..."
                                            bind:value={comments[entry.id]}
                                            oninput={() => onCommentInput(entry.id)}
                                            class:unsaved={saveStatuses[entry.id] === 'pending' || saveStatuses[entry.id] === 'saving'}
                                            class:saved={saveStatuses[entry.id] === 'saved'}
                                    ></textarea>
                                {#if saveStatuses[entry.id] === 'saving'}
                                    <span class="comment-status">Saving...</span>
                                {:else if saveStatuses[entry.id] === 'saved'}
                                    <span class="comment-status saved">Saved</span>
                                {:else if saveStatuses[entry.id] === 'error'}
                                    <span class="comment-status error">Error saving</span>
                                {/if}
                            </td>
                            <td class="col-edited-by">
                                {lastEditedByState[entry.id] ?? '—'}
                            </td>
                        </tr>
                    {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    {/if}
</main>