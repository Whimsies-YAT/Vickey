<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkInfo>
		{{ i18n.ts._oauthAppVK.description }}
	</MkInfo>

	<MkButton primary rounded style="margin: 0 auto;" @click="createOAuthApp">
		<i class="ti ti-plus"></i>
		{{ i18n.ts._oauthAppVK.createApp }}
	</MkButton>

	<MkPagination :paginator="oauthAppsPaginator">
		<template #empty>
			<MkResult type="empty">
				<div>{{ i18n.ts._oauthAppVK.noApp }}</div>
				<div style="font-size: 0.8em; opacity: 0.7;">{{ i18n.ts._oauthAppVK.createDescription }}</div>
			</MkResult>
		</template>
		<template #default="{items}">
			<div class="_gaps">
				<MkFolder v-for="app in items" :key="app.id" :defaultOpen="false">
					<template #icon>
						<img v-if="app.iconUrl" :src="app.iconUrl" :class="$style.appIcon" alt="icon" @error="(e) => ((e.target as HTMLElement)?.style && ((e.target as HTMLElement).style.display = 'none'))">
						<i v-else class="ti ti-apps"></i>
					</template>
					<template #label>{{ app.name }}</template>
					<template #caption>{{ getShortClientId(app.id) }}</template>
					<template #suffix>
						<MkTime :time="app.createdAt"/>
					</template>
					<template #footer>
						<div :class="$style.appActions">
							<MkButton @click="editApp(app)">
								<i class="ti ti-pencil"></i>
								Edit
							</MkButton>
							<MkButton danger @click="deleteApp(app)">
								<i class="ti ti-trash"></i>
								Delete
							</MkButton>
						</div>
					</template>

					<div class="_gaps_s">
						<div v-if="app.description" :class="$style.description">{{ app.description }}</div>

						<MkKeyValue oneline>
							<template #key><i class="ti ti-id"></i> {{ i18n.ts._oauthAppVK.id }}</template>
							<template #value>
								<code :class="$style.credential" @click="copyToClipboard(app.id)">
									{{ app.id }}
									<i class="ti ti-copy"></i>
								</code>
							</template>
						</MkKeyValue>

						<MkKeyValue oneline>
							<template #key><i class="ti ti-key"></i> {{ i18n.ts._oauthAppVK.secret }}</template>
							<template #value>
								<code :class="$style.credential" @click="copySecret(app)">
									{{ app.secret || i18n.ts.notAvailable }}
									<i v-if="app.secret" class="ti ti-copy"></i>
								</code>
							</template>
						</MkKeyValue>

						<MkKeyValue v-if="app.callbackUrl" oneline>
							<template #key><i class="ti ti-link"></i> {{ i18n.ts._oauthAppVK.callbackURL }}</template>
							<template #value>{{ app.callbackUrl }}</template>
						</MkKeyValue>

						<MkKeyValue v-if="app.websiteUrl" oneline>
							<template #key><i class="ti ti-world"></i> {{ i18n.ts._oauthAppVK.website }}</template>
							<template #value><a :href="app.websiteUrl" target="_blank" rel="noopener noreferrer">{{ app.websiteUrl }}</a></template>
						</MkKeyValue>

						<MkKeyValue oneline>
							<template #key><i class="ti ti-api"></i> {{ i18n.ts._oauthAppVK.endpoints }}</template>
							<template #value>
								<div :class="$style.endpoints">
									<div><strong>{{ i18n.ts._oauthAppVK.authorization }}</strong> {{ url }}/oauth/authorize</div>
									<div><strong>{{ i18n.ts._oauthAppVK.token }}</strong> {{ url }}/oauth/token</div>
									<div><strong>{{ i18n.ts._oauthAppVK.revoke }}</strong> {{ url }}/oauth/revoke</div>
								</div>
							</template>
						</MkKeyValue>

						<MkFolder>
							<template #label><i class="ti ti-shield-check"></i> {{ i18n.ts._oauthAppVK.scopes }}</template>
							<template #suffix>{{ app.permission.length }}</template>
							<div :class="$style.scopes">
								<span v-for="p in app.permission" :key="p" :class="$style.scope">{{ p }}</span>
							</div>
						</MkFolder>
					</div>
				</MkFolder>
			</div>
		</template>
	</MkPagination>
</div>
</template>

<script lang="ts" setup>
import { markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import MkPagination from '@/components/MkPagination.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import { Paginator } from '@/utility/paginator.js';
import * as os from '@/os.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { url } from '@@/js/config.js';
import { i18n } from '@/i18n.js';

const oauthAppsPaginator = markRaw(new Paginator('oauth-apps/list', {
	limit: 10,
	noPaging: true,
}));

function getShortClientId(clientId: string): string {
	const match = clientId.match(/\/oauth\/app\/(.+)$/);
	return match ? `...${match[1].substring(0, 8)}` : clientId.substring(0, 16) + '...';
}

async function createOAuthApp() {
	const { canceled: basicInfoCanceled, result: basicInfo } = await os.form(i18n.ts._oauthAppVK.createApp, {
		name: {
			type: 'string',
			label: i18n.ts._oauthAppVK.appName,
			placeholder: i18n.ts._oauthAppVK.myApp,
		},
		description: {
			type: 'string',
			label: i18n.ts._oauthAppVK.appDescription,
			placeholder: i18n.ts._oauthAppVK.appDescriptionText,
		},
		callbackUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.callbackURL,
			placeholder: 'https://yourapp.com/auth/callback',
		},
		iconUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.iconURL,
			placeholder: 'https://yourapp.com/icon.png',
		},
		websiteUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.websiteURL,
			placeholder: 'https://yourapp.com',
		},
	});

	if (basicInfoCanceled) return;

	const permissionResult = await new Promise<{ name: string | null, permissions: string[] } | null>((resolve) => {
		os.popupAsyncWithDialog(import('@/components/MkTokenGenerateWindow.vue').then(x => x.default), {
			title: 'Select Permissions',
			initialPermissions: null,
			initialName: null,
		}, {
			done: async (result: { name: string | null, permissions: string[] }) => {
				resolve(result);
			},
			closed: () => {
				resolve(null);
			},
		});
	});

	if (!permissionResult) return;

	try {
		const createdApp = await misskeyApi('oauth-apps/create', {
			name: basicInfo.name,
			description: basicInfo.description,
			callbackUrl: basicInfo.callbackUrl || null,
			iconUrl: basicInfo.iconUrl || null,
			websiteUrl: basicInfo.websiteUrl || null,
			permission: permissionResult.permissions,
		}) as Misskey.entities.App;

		await os.alert({
			type: 'success',
			title: i18n.ts._oauthAppVK.created,
			text: `${ i18n.ts._oauthAppVK.idAlt } ${ createdApp.id }\n\n${ i18n.ts._oauthAppVK.secretAlt } ${ createdApp.fullSecret ?? '' }\n\n⚠️ ${ i18n.ts._oauthAppVK.firstTime }`,
		});

		oauthAppsPaginator.reload();
	} catch (error) {
		os.alert({
			type: 'error',
			text: (error as Error).message || i18n.ts._oauthAppVK.createFailed,
		});
	}
}

async function editApp(app: any) {
	const { canceled: basicInfoCanceled, result: basicInfo } = await os.form(i18n.ts._oauthAppVK.editApp, {
		name: {
			type: 'string',
			label: i18n.ts._oauthAppVK.appName,
			default: app.name,
		},
		description: {
			type: 'string',
			label: i18n.ts._oauthAppVK.appDescription,
			default: app.description,
		},
		callbackUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.callbackURL,
			default: app.callbackUrl,
		},
		iconUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.iconURL,
			default: app.iconUrl,
		},
		websiteUrl: {
			type: 'string',
			label: i18n.ts._oauthAppVK.websiteURL,
			default: app.websiteUrl,
		},
	});

	if (basicInfoCanceled) return;

	const permissionResult = await new Promise<{ name: string | null, permissions: string[] } | null>((resolve) => {
		os.popupAsyncWithDialog(import('@/components/MkTokenGenerateWindow.vue').then(x => x.default), {
			title: 'Select Permissions',
			initialPermissions: app.permission,
			initialName: null,
		}, {
			done: async (result: { name: string | null, permissions: string[] }) => {
				resolve(result);
			},
			closed: () => {
				resolve(null);
			},
		});
	});

	if (!permissionResult) return;

	try {
		await misskeyApi('oauth-apps/update', {
			appId: app.id,
			name: basicInfo.name,
			description: basicInfo.description,
			permission: permissionResult.permissions,
			callbackUrl: basicInfo.callbackUrl || null,
			iconUrl: basicInfo.iconUrl || null,
			websiteUrl: basicInfo.websiteUrl || null,
		});

		os.success();
		oauthAppsPaginator.reload();
	} catch (error) {
		os.alert({
			type: 'error',
			text: (error as Error).message || i18n.ts._oauthAppVK.updateFailed,
		});
	}
}

async function deleteApp(app: any) {
	const { canceled } = await os.confirm({
		type: 'warning',
		title: i18n.ts._oauthAppVK.deleteApp,
		text: `${ i18n.tsx._oauthAppVK.deleteDescription(app.name) }`,
	});

	if (canceled) return;

	try {
		await misskeyApi('oauth-apps/delete', { appId: app.id });
		os.success();
		oauthAppsPaginator.reload();
	} catch (error) {
		os.alert({
			type: 'error',
			text: (error as Error).message || i18n.ts._oauthAppVK.deleteFailed,
		});
	}
}

async function copySecret(app: any) {
	if (app.secret) {
		copyToClipboard(app.secret);
		os.toast(i18n.ts._oauthAppVK.copySecret);
	} else {
		os.alert({
			type: 'error',
			text: i18n.ts.notAvailable,
		});
	}
}

definePage(() => ({
	title: i18n.ts._oauthAppVK.title,
	icon: 'ti ti-api',
}));
</script>

<style lang="scss" module>
.description {
	padding: 8px 0;
	font-size: 0.9em;
	opacity: 0.8;
}

.appActions {
	display: flex;
	gap: 8px;
}

.credential {
	font-family: monospace;
	font-size: 0.85em;
	padding: 6px 10px;
	background: var(--MI_THEME-buttonBg);
	border-radius: 6px;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 8px;
	transition: background 0.2s;
	user-select: all;
	max-width: 300px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	i {
		opacity: 0.7;
		font-size: 0.9em;
		user-select: none;
	}
}

.endpoints {
	font-size: 0.8em;
	line-height: 1.4;
	font-family: monospace;

	div {
		margin: 2px 0;
	}

	strong {
		display: inline-block;
		width: 100px;
		color: var(--MI_THEME-accent);
	}
}

.buttonGroup {
	display: flex;
	gap: 12px;
	justify-content: center;
	flex-wrap: wrap;
}

.appIcon {
	width: 20px;
	height: 20px;
	object-fit: cover;
	border-radius: 4px;
}

.scopes {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 8px;
}

.scope {
	display: inline-block;
	padding: 2px 8px;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	border-radius: 12px;
	font-size: 0.75em;
	font-weight: 500;
}
</style>
