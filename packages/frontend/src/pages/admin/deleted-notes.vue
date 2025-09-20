<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><MkPageHeader :actions="headerActions" :tabs="headerTabs"/></template>
	<MkSpacer :contentMax="1200">
		<div class="_gaps">
			<div class="_panel" style="padding: 16px;">
				<div class="_gaps_m">
					<div style="display: flex; gap: 8px; flex-wrap: wrap;">
						<MkInput v-model="userId" placeholder="User ID (optional)" style="flex: 1; min-width: 200px;">
							<template #prefix><i class="ph ph-user ph-fw"></i></template>
						</MkInput>
						<MkInput v-model="deletedAfter" type="datetime-local" placeholder="Deleted after" style="flex: 1; min-width: 200px;">
							<template #prefix><i class="ph ph-calendar ph-fw"></i></template>
						</MkInput>
						<MkInput v-model="deletedBefore" type="datetime-local" placeholder="Deleted before" style="flex: 1; min-width: 200px;">
							<template #prefix><i class="ph ph-calendar ph-fw"></i></template>
						</MkInput>
					</div>
					<div style="display: flex; gap: 8px;">
						<MkButton primary @click="search"><i class="ph ph-magnifying-glass ph-fw"></i> {{ i18n.ts.searchDeletedNotes }}</MkButton>
						<MkButton @click="refresh"><i class="ph ph-arrow-clockwise ph-fw"></i> {{ i18n.ts.refreshDeletedNotes }}</MkButton>
						<MkButton @click="clear"><i class="ph ph-trash ph-fw"></i> {{ i18n.ts.clearFilters }}</MkButton>
					</div>
				</div>
			</div>

			<div v-if="notes.length === 0 && !loading" class="_panel" style="padding: 32px; text-align: center;">
				<div style="opacity: 0.7;">
					<i class="ph ph-magnifying-glass ph-fw" style="font-size: 3em;"></i>
					<div style="font-size: 120%; margin-top: 8px;">{{ i18n.ts.noDeletedNotesFound }}</div>
				</div>
			</div>

			<MkLoading v-if="loading"/>

			<div v-else class="_gaps">
				<div v-for="note in notes" :key="note.id" class="_panel deleted-note">
					<div class="note-header">
						<MkAvatar :user="note.user" class="avatar"/>
						<div class="user-info">
							<MkUserName :user="note.user"/>
							<div class="username">@{{ note.user.username }}{{ note.user.host ? '@' + note.user.host : '' }}</div>
						</div>
						<div class="note-id">{{ note.id }}</div>
						<div class="deleted-badge">
							<i class="ph ph-trash ph-fw"></i> {{ String(i18n.ts.deleted).toUpperCase() }}
						</div>
					</div>
					<div class="note-content">
						<div v-if="note.cw" class="cw">
							<strong>{{ i18n.ts.cw }}:</strong> {{ note.cw }}
						</div>
						<div v-if="note.text" class="text">
							{{ note.text }}
						</div>
						<div v-if="note.files && note.files.length > 0" class="files">
							<div class="file-count">
								<i class="ph ph-paperclip ph-fw"></i> {{ note.files.length }} {{ i18n.ts.files }}
							</div>
						</div>
					</div>
					<div class="note-meta">
						<div class="timestamps">
							<div><strong>{{ i18n.ts.created }}:</strong> <MkTime :time="new Date(getTimestampFromId(note.id))" mode="absolute"/></div>
							<div v-if="note.updatedAt"><strong>{{ i18n.ts.deleted }}:</strong> <MkTime :time="note.updatedAt" mode="absolute"/></div>
						</div>
						<div class="actions">
							<MkButton size="small" @click="viewNote(note)">
								<i class="ph ph-eye ph-fw"></i> {{ i18n.ts.viewDeletedNote }}
							</MkButton>
						</div>
					</div>
				</div>
			</div>

			<div v-if="hasMore" style="text-align: center; margin-top: 16px;">
				<MkButton :loading="loadingMore" @click="loadMore">
					<i class="ph ph-arrow-down ph-fw"></i> {{ i18n.ts.loadMore }}
				</MkButton>
			</div>
		</div>
	</MkSpacer>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkUserName from '@/components/global/MkUserName.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import MkTime from '@/components/global/MkTime.vue';
import { definePage } from '@/page.js';
import { transform } from '@/utility/convert-id.js';

const loading = ref(false);
const loadingMore = ref(false);
const notes = ref<any[]>([]);
const hasMore = ref(true);
const userId = ref('');
const deletedAfter = ref('');
const deletedBefore = ref('');

const headerActions = computed(() => []);
const headerTabs = computed(() => []);

function formatTime(dateStr: string): string {
	return new Date(dateStr).toLocaleString();
}

function getTimestampFromId(id: string): number {
	const aidRegexp = /^[0-9a-z]{10}$/;
	const aidxRegexp = /^[0-9a-z]{16}$/;
	const meidRegexp = /^[0-9a-f]{24}$/;
	const meidgRegexp = /^g[0-9a-f]{23}$/;
	const objectIdRegexp = /^[0-9a-f]{24}$/;
	const ulidRegexp = /^[0-9A-Z]{26}$/;

	if (aidRegexp.test(id)) {
		const timestamp = transform('aid', 'timestamp', id);
		return parseInt(timestamp, 10);
	} else if (aidxRegexp.test(id)) {
		const timestamp = transform('aidx', 'timestamp', id);
		return parseInt(timestamp, 10);
	} else if (meidgRegexp.test(id)) {
		const timestamp = transform('meidg', 'timestamp', id);
		return parseInt(timestamp, 10);
	} else if (meidRegexp.test(id)) {
		const timestamp = transform('meid', 'timestamp', id);
		return parseInt(timestamp, 10);
	} else if (objectIdRegexp.test(id)) {
		const timestamp = transform('objectId', 'timestamp', id);
		return parseInt(timestamp, 10);
	} else if (ulidRegexp.test(id)) {
		const timestamp = transform('ulid', 'timestamp', id);
		return parseInt(timestamp, 10);
	}
	return -1;
}

async function loadNotes(reset = true) {
	if (reset) {
		notes.value = [];
		hasMore.value = true;
		loading.value = true;
	} else {
		loadingMore.value = true;
	}

	try {
		const params: any = {
			limit: 20,
		};

		if (userId.value) params.userId = userId.value;
		if (deletedAfter.value) params.deletedAfter = new Date(deletedAfter.value).toISOString();
		if (deletedBefore.value) params.deletedBefore = new Date(deletedBefore.value).toISOString();

		if (!reset && notes.value.length > 0) {
			params.untilId = notes.value[notes.value.length - 1].id;
		}

		const res: any = await misskeyApi('admin/notes/list-deleted', params);

		if (reset) {
			notes.value = res;
		} else {
			notes.value = [...notes.value, ...res];
		}

		hasMore.value = res.length >= 20;
	} catch (error) {
		os.alert({
			type: 'error',
			title: String(i18n.ts.error),
			text: (error as Error).message || String(i18n.ts.failedToLoadDeletedNotes),
		});
	} finally {
		loading.value = false;
		loadingMore.value = false;
	}
}

function search() {
	loadNotes(true);
}

function refresh() {
	loadNotes(true);
}

function clear() {
	userId.value = '';
	deletedAfter.value = '';
	deletedBefore.value = '';
	loadNotes(true);
}

function loadMore() {
	if (hasMore.value && !loadingMore.value) {
		loadNotes(false);
	}
}

async function viewNote(note: any) {
	try {
		const fullNote: any = await misskeyApi('admin/notes/show-deleted', { noteId: note.id });

		os.alert({
			type: 'info',
			title: String(i18n.ts.deletedNoteDetailsTitle),
			text: `${i18n.ts.user}: @${fullNote.user.username}${fullNote.user.host ? '@' + fullNote.user.host : ''}
${i18n.ts.id}: ${fullNote.id}
${i18n.ts.created}: ${formatTime(new Date(getTimestampFromId(fullNote.id)).toISOString())}
${i18n.ts.updatedAlt}: ${formatTime(fullNote.updatedAt)}
${i18n.ts.deleted}: ${fullNote.isDeleted ? i18n.ts.yes : i18n.ts.no}

${fullNote.cw ? String(i18n.ts.cw) + ': ' + fullNote.cw + '\n\n' : ''}${fullNote.text || String(i18n.ts.noTextContent)}`,
		});
	} catch (error) {
		os.alert({
			type: 'error',
			title: i18n.ts.error,
			text: (error as Error).message || i18n.ts.failedToLoadNoteDetails,
		});
	}
}

onMounted(() => {
	loadNotes(true);
});

definePage(() => ({
	title: i18n.ts.deletedNotes,
	icon: 'ph ph-trash ph-fw',
}));
</script>

<style lang="scss" scoped>
.deleted-note {
	padding: 16px;
	border-left: 4px solid #ff4757;

	.note-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;

		.avatar {
			width: 40px;
			height: 40px;
		}

		.user-info {
			flex: 1;

			.username {
				opacity: 0.7;
				font-size: 0.9em;
			}
		}

		.note-id {
			font-family: monospace;
			font-size: 0.8em;
			opacity: 0.7;
		}

		.deleted-badge {
			background: #ff4757;
			color: white;
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 0.8em;
			font-weight: bold;
		}
	}

	.note-content {
		margin-bottom: 12px;
		padding-left: 52px;

		.cw {
			background: rgba(255, 71, 87, 0.1);
			padding: 8px;
			border-radius: 4px;
			margin-bottom: 8px;
		}

		.text {
			line-height: 1.5;
			white-space: pre-wrap;
			word-break: break-word;
		}

		.files {
			margin-top: 8px;
			opacity: 0.7;
		}
	}

	.note-meta {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding-left: 52px;
		font-size: 0.9em;
		opacity: 0.8;

		.timestamps > div {
			margin-bottom: 4px;
		}
	}
}
</style>
