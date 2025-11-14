<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<div class="_card">
				<div class="_title">{{ i18n.ts._accountLink.createAccountLink }}</div>
				<div class="_content">
					<div class="_gaps_m">
						<MkSelect v-model="linkMode" style="flex: 1;" :items="linkModeItems">
							<template #label>{{ i18n.ts._accountLink.mode }}</template>
						</MkSelect>

						<div v-if="linkMode === 'pair'" class="_gaps_m">
							<MkInput v-model="user1Id" style="flex: 1;" type="text" :spellcheck="false">
								<template #label>{{ i18n.ts._accountLink.user1 }}</template>
							</MkInput>
							<MkInput v-model="user2Id" style="flex: 1;" type="text" :spellcheck="false">
								<template #label>{{ i18n.ts._accountLink.user2 }}</template>
							</MkInput>
							<MkButton primary :disabled="!user1Id || !user2Id" @click="createLink">
								{{ i18n.ts.create }}
							</MkButton>
						</div>

						<div v-else-if="linkMode === 'group'" class="_gaps_m">
							<MkInput v-model="groupName" type="text" :spellcheck="false">
								<template #label>{{ i18n.ts._accountLink.groupName }}</template>
							</MkInput>
							<MkInput v-model="groupDescription" type="text" :spellcheck="false">
								<template #label>{{ i18n.ts._accountLink.groupDesc }}</template>
							</MkInput>
							<MkTextarea v-model="userIdsText" style="height: 120px;">
								<template #label>{{ i18n.ts._accountLink.userIds }}</template>
							</MkTextarea>
							<div v-if="parsedUserIds.length > 0" class="group-preview">
								<div class="label">{{ i18n.ts._accountLink.usersToLink }} {{ parsedUserIds.length }}</div>
								<div class="user-list">{{ parsedUserIds.join(', ') }}</div>
							</div>
							<MkButton primary :disabled="parsedUserIds.length < 2" @click="createGroup">
								{{ i18n.tsx._accountLink.createGroup({ length: parsedUserIds.length }) }}
							</MkButton>
						</div>
					</div>
				</div>
			</div>

			<div class="_card">
				<div class="_title">{{ i18n.ts._accountLink.listAccountLinks }}</div>
				<div class="_content">
					<div class="_gaps_m">
						<div :class="$style.inputs">
							<MkInput v-model="searchUserId" style="flex: 1;" type="text" :spellcheck="false">
								<template #label>{{ i18n.ts.userId }}</template>
							</MkInput>
							<MkButton @click="searchLinks">{{ i18n.ts.search }}</MkButton>
							<MkButton :disabled="!searchUserId" @click="viewNetwork">{{ i18n.ts._accountLink.network }}</MkButton>
						</div>

						<div v-if="showNetwork && network" class="network-display">
							<div class="network-header">
								<h3>{{ i18n.tsx._accountLink.networkFor({ user: searchUserId }) }}</h3>
								<MkButton size="sm" @click="showNetwork = false">{{ i18n.ts._smartTimeline.closeNetwork }}</MkButton>
							</div>
							<div class="network-stats">
								<div class="stat-item">
									<span class="label">{{ i18n.ts._accountLink.nodes }}</span>
									<span class="value">{{ network.nodes.length }}</span>
								</div>
								<div class="stat-item">
									<span class="label">{{ i18n.ts._accountLink.links }}</span>
									<span class="value">{{ network.edges.length }}</span>
								</div>
								<div class="stat-item">
									<span class="label">{{ i18n.ts._accountLink.groups }}</span>
									<span class="value">{{ network.groups.length }}</span>
								</div>
							</div>
							<div class="network-visualization">
								<div class="network-nodes">
									<h4>{{ i18n.ts._accountLink.connected }}</h4>
									<div class="node-list">
										<div v-for="node in network.nodes" :key="node.id" class="node-item">
											<div class="node-name">{{ node.name }}</div>
											<div class="node-id">{{ node.id }}</div>
											<div v-if="node.metadata?.host" class="node-host">@{{ node.metadata.host }}</div>
										</div>
									</div>
								</div>
								<div v-if="network.groups.length > 0" class="network-groups">
									<h4>{{ i18n.ts._accountLink.groups }}</h4>
									<div class="group-list">
										<div v-for="group in network.groups" :key="group.name" class="group-item">
											<div class="group-name">{{ group.name }}</div>
											<div v-if="group.metadata?.description" class="group-description">{{ group.metadata.description }}</div>
											<div class="group-stats">
												{{ i18n.tsx._accountLink.usersNum({ length: group.userIds.length }) }},
												{{ i18n.tsx._accountLink.linksNum({ linkCount: group.metadata?.linkCount ?? 0 }) }},
												{{ i18n.tsx._accountLink.confidenceNum({ confidence: Math.round(((group.metadata?.confidence ?? 0) * 100)) }) }}
											</div>
											<div class="group-users">{{ group.userIds.join(', ') }}</div>
										</div>
									</div>
								</div>
							</div>
						</div>

						<div v-if="links && links.length > 0" class="_gaps_s">
							<div v-for="link in links" :key="link.id" class="link-item">
								<div class="link-info">
									<div><strong>{{ i18n.ts._accountLink.linkId }}</strong> {{ link.id }}</div>
									<div><strong>{{ i18n.ts._accountLink.primUser }}</strong> {{ link.primaryUserId }}</div>
									<div><strong>{{ i18n.ts._accountLink.linkedUser }}</strong> {{ link.linkedUserId }}</div>
									<div><strong>{{ i18n.ts._accountLink.confidence }}</strong> {{ Math.round(link.confidence * 100) }}%</div>
									<div><strong>{{ i18n.ts._accountLink.methods }}</strong> {{ link.detectionMethods.join(', ') }}</div>
									<div><strong>{{ i18n.ts._accountLink.manual }}</strong> {{ link.isManual ? 'Yes' : 'No' }}</div>
									<div><strong>{{ i18n.ts._accountLink.created }}</strong> {{ dateString(link.createdAt) }}</div>
									<div v-if="link.metadata?.groupName"><strong>{{ i18n.ts._accountLink.groupTxt }}</strong> {{ link.metadata.groupName }}</div>
								</div>
								<MkButton danger @click="removeLink(link.id)">{{ i18n.ts.remove }}</MkButton>
							</div>
						</div>

						<div v-else-if="searched && links?.length === 0" class="no-links">
							<MkInfo>{{ i18n.ts._accountLink.noLinks }}</MkInfo>
						</div>
					</div>
				</div>
			</div>

			<div v-if="error" class="error">
				<MkInfo warn>{{ error }}</MkInfo>
			</div>

			<div v-if="success" class="success">
				<MkInfo>{{ success }}</MkInfo>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { dateString } from '@/filters/date.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type AccountLinkMetadata = {
	groupName?: string;
	groupDescription?: string;
	linkCount?: number;
	confidence?: number;
	[key: string]: unknown;
};

type AccountLink = {
	id: string;
	primaryUserId: string;
	linkedUserId: string;
	confidence: number;
	detectionMethods: string[];
	createdAt: string;
	isManual: boolean;
	metadata?: AccountLinkMetadata;
};

type AccountLinkGroupInfo = {
	name: string;
	description?: string | null;
	userCount: number;
	linkCount: number;
};

type AccountLinkGroupPayload = {
	groupId: string;
	userIds: string[];
	links: AccountLink[];
	groupInfo: AccountLinkGroupInfo;
};

type AccountLinkNetwork = {
	nodes: {
		id: string;
		name: string;
		type: 'user';
		metadata?: {
			host?: string | null;
		};
	}[];
	edges: {
		from: string;
		to: string;
		confidence: number;
		methods: string[];
		isManual: boolean;
		metadata?: Record<string, unknown>;
	}[];
	groups: {
		name: string;
		userIds: string[];
		metadata?: {
			description?: string;
			linkCount?: number;
			confidence?: number;
		};
	}[];
};

type ManageAccountLinksBasicResponse = { success: true };
type ManageAccountLinksCreateResponse = { success: true; group: AccountLinkGroupPayload };
type ManageAccountLinksListResponse = { success: true; links: AccountLink[] };
type ManageAccountLinksNetworkResponse = { success: true; network: AccountLinkNetwork };

const linkMode = ref('pair');
const user1Id = ref('');
const user2Id = ref('');
const groupName = ref('');
const groupDescription = ref('');
const userIdsText = ref('');
const searchUserId = ref('');
const links = ref<AccountLink[]>([]);
const searched = ref(false);
const network = ref<AccountLinkNetwork | null>(null);
const showNetwork = ref(false);
const error = ref('');
const success = ref('');

const linkModeItems = [
	{ label: i18n.ts._accountLink.pair, value: 'pair' },
	{ label: i18n.ts._accountLink.group, value: 'group' },
];

const parsedUserIds = computed(() => {
	if (!userIdsText.value.trim()) return [];

	const ids = userIdsText.value
		.split(/[,\n]/)
		.map(id => id.trim())
		.filter(id => id.length > 0);

	return [...new Set(ids)];
});

async function createLink() {
	if (!user1Id.value.trim() || !user2Id.value.trim()) {
		error.value = i18n.ts._accountLink.userIdsRequired;
		return;
	}

	try {
		error.value = '';
		success.value = '';

		const result = await misskeyApi('admin/users/manage-account-links', {
			operation: 'create',
			userIds: [user1Id.value.trim(), user2Id.value.trim()],
		} as any) as ManageAccountLinksBasicResponse | undefined;

		if (!result?.success) {
			error.value = i18n.ts._accountLink.createFailed;
			return;
		}

		const createdUserIds = [user1Id.value.trim(), user2Id.value.trim()];

		success.value = i18n.ts._accountLink.createdSucc;
		user1Id.value = '';
		user2Id.value = '';

		if (searchUserId.value && createdUserIds.includes(searchUserId.value)) {
			await searchLinks();
		}
	} catch (err: any) {
		error.value = err.message || i18n.ts._accountLink.createFailed;
	}
}

async function searchLinks() {
	if (!searchUserId.value.trim()) {
		error.value = i18n.ts.requireUserId;
		return;
	}

	try {
		error.value = '';
		success.value = '';
		searched.value = false;

		const result = await misskeyApi('admin/users/manage-account-links', {
			operation: 'list',
			userId: searchUserId.value.trim(),
		} as any) as ManageAccountLinksListResponse | undefined;

		if (!result?.success) {
			throw new Error('Failed to fetch account links');
		}

		links.value = result.links ?? [];
		searched.value = true;
	} catch (err: any) {
		error.value = err.message || i18n.ts._accountLink.searchFailed;
		links.value = [];
		searched.value = true;
	}
}

async function createGroup() {
	if (parsedUserIds.value.length < 2) {
		error.value = i18n.ts._accountLink.atLeast2;
		return;
	}

	try {
		error.value = '';
		success.value = '';

		const result = await misskeyApi('admin/users/manage-account-links', {
			operation: 'create',
			userIds: parsedUserIds.value,
			groupName: groupName.value.trim() || undefined,
			groupDescription: groupDescription.value.trim() || undefined,
		} as any) as ManageAccountLinksCreateResponse | undefined;

		if (!result?.success) {
			throw new Error(i18n.ts._accountLink.createGroupFailed);
		}

		const groupInfo = result.group.groupInfo;
		success.value = i18n.tsx._accountLink.groupCreated1({ name: groupInfo.name }) +
			i18n.tsx._accountLink.groupCreated2({ userCount: groupInfo.userCount, linkCount: groupInfo.linkCount });

		userIdsText.value = '';
		groupName.value = '';
		groupDescription.value = '';

		if (searchUserId.value && parsedUserIds.value.includes(searchUserId.value)) {
			await searchLinks();
		}
	} catch (err: any) {
		error.value = err.message || i18n.ts._accountLink.createGroupFailed;
	}
}

async function removeLink(linkId: string) {
	try {
		error.value = '';
		success.value = '';

		const result = await misskeyApi('admin/users/manage-account-links', {
			operation: 'remove',
			linkId: linkId,
		} as any) as ManageAccountLinksBasicResponse | undefined;

		if (!result?.success) {
			throw new Error(i18n.ts._accountLink.removeFailed);
		}

		success.value = i18n.ts._accountLink.removedSucc;
		if (searchUserId.value) {
			await searchLinks();
		}
	} catch (err: any) {
		error.value = err.message || i18n.ts._accountLink.removeFailed;
	}
}

async function viewNetwork() {
	if (!searchUserId.value.trim()) {
		error.value = i18n.ts.requireUserId;
		return;
	}

	try {
		error.value = '';
		network.value = null;

		const result = await misskeyApi('admin/users/manage-account-links', {
			operation: 'getNetwork',
			userId: searchUserId.value.trim(),
		} as any) as ManageAccountLinksNetworkResponse | undefined;

		if (!result?.success) {
			throw new Error(i18n.ts._accountLink.loadNetworkFailed);
		}

		network.value = result.network;
		showNetwork.value = true;
	} catch (err: any) {
		error.value = err.message || i18n.ts._accountLink.loadNetworkFailed;
		network.value = null;
	}
}

const headerActions = computed(() => []);

definePage(() => ({
	title: i18n.ts.accountLinksManagement,
	icon: 'ti ti-link',
}));
</script>

<style lang="scss" module>
.inputs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: end;
}
</style>

<style lang="scss" scoped>
.link-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 6px;

	.link-info {
		flex: 1;

		> div {
			margin-bottom: 4px;

			&:last-child {
				margin-bottom: 0;
			}
		}
	}
}

.no-links {
	text-align: center;
	padding: 20px;
}

.error, .success {
	margin-top: 16px;
}

.group-preview {
	padding: 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 6px;
	background: var(--MI_THEME-bg);

	.label {
		font-weight: bold;
		margin-bottom: 8px;
	}

	.user-list {
		font-size: 0.9em;
		color: var(--MI_THEME-fgTransparentWeak);
		word-break: break-all;
	}
}

.network-display {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 16px;
	margin: 16px 0;
	background: var(--MI_THEME-panel);

	.network-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;

		h3 {
			margin: 0;
			color: var(--MI_THEME-accent);
		}
	}

	.network-stats {
		display: flex;
		gap: 24px;
		margin-bottom: 20px;

		.stat-item {
			.label {
				font-weight: bold;
				margin-right: 8px;
			}

			.value {
				color: var(--MI_THEME-accent);
				font-weight: bold;
			}
		}
	}

	.network-visualization {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;

		@media (max-width: 768px) {
			grid-template-columns: 1fr;
		}

		h4 {
			margin: 0 0 12px 0;
			color: var(--MI_THEME-fg);
			border-bottom: 1px solid var(--MI_THEME-divider);
			padding-bottom: 8px;
		}

		.node-list, .group-list {
			max-height: 300px;
			overflow-y: auto;
		}

		.node-item {
			padding: 8px;
			border: 1px solid var(--MI_THEME-divider);
			border-radius: 4px;
			margin-bottom: 8px;
			background: var(--MI_THEME-bg);

			.node-name {
				font-weight: bold;
				color: var(--MI_THEME-accent);
			}

			.node-id {
				font-size: 0.85em;
				color: var(--MI_THEME-fgTransparentWeak);
				font-family: monospace;
			}

			.node-host {
				font-size: 0.8em;
				color: var(--MI_THEME-fgTransparentWeak);
			}
		}

		.group-item {
			padding: 12px;
			border: 1px solid var(--MI_THEME-accent);
			border-radius: 6px;
			margin-bottom: 12px;
			background: var(--MI_THEME-accentedBg);

			.group-name {
				font-weight: bold;
				font-size: 1.1em;
				color: var(--MI_THEME-accent);
				margin-bottom: 4px;
			}

			.group-description {
				color: var(--MI_THEME-fg);
				margin-bottom: 8px;
				font-style: italic;
			}

			.group-stats {
				font-size: 0.9em;
				color: var(--MI_THEME-fgTransparentWeak);
				margin-bottom: 8px;
			}

			.group-users {
				font-size: 0.85em;
				color: var(--MI_THEME-fgTransparentWeak);
				font-family: monospace;
				word-break: break-all;
			}
		}
	}
}
</style>
