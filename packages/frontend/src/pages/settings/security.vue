<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/security" :label="i18n.ts.security" :keywords="['security']" icon="ti ti-lock" :inlining="['2fa']">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/client-assets/locked_with_key_3d.png" color="#ffbf00">
			<SearchText>{{ i18n.ts._settings.securityBanner }}</SearchText>
		</MkFeatureBanner>

		<SearchMarker :keywords="['password']">
			<FormSection first>
				<template #label><SearchLabel>{{ i18n.ts.password }}</SearchLabel></template>

				<SearchMarker>
					<MkButton primary @click="change()">
						<SearchLabel>{{ i18n.ts.changePassword }}</SearchLabel>
					</MkButton>
				</SearchMarker>
			</FormSection>
		</SearchMarker>

		<X2fa/>

		<SearchMarker :keywords="['signin', 'login', 'history', 'log']">
			<FormSection>
				<template #label><SearchLabel>{{ i18n.ts.signinHistory }}</SearchLabel></template>
				<MkPagination :paginator="paginator" withControl>
					<template #default="{items}">
						<div>
							<div v-for="item in items" :key="item.id" v-panel class="timnmucd" @click.stop="showIP(item.ip)">
								<header>
									<i v-if="item.success" class="ti ti-check icon succ"></i>
									<i v-else class="ti ti-circle-x icon fail"></i>
									<code class="ip _monospace">{{ formatIpAddress(item.ip) }}</code>
									<code class="location _monospace">{{ formatLocation(item.ip) }}</code>
									<MkTime :time="item.createdAt" class="time"/>
								</header>
							</div>
						</div>
					</template>
				</MkPagination>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['session', 'device', 'active', 'sessions', 'devices']">
			<FormSection>
				<template #label><SearchLabel>{{ i18n.ts.activeSessions }}</SearchLabel></template>
				<template #caption>{{ i18n.ts.activeSessionsDescription }}</template>

				<div v-if="sessions === null" style="text-align: center; padding: 16px;">
					<MkLoading/>
				</div>

				<div v-else-if="sessions.length === 0" style="text-align: center; padding: 16px; opacity: 0.7;">
					{{ i18n.ts.noActiveSessions }}
				</div>

				<div v-else class="_gaps_s">
					<div v-for="session in sessions" :key="session.id" v-panel class="session-item">
						<div class="session-header">
							<i v-if="session.deviceType === 'mobile'" class="ti ti-device-mobile icon"></i>
							<i v-else-if="session.deviceType === 'desktop'" class="ti ti-device-desktop icon"></i>
							<i v-else class="ti ti-devices icon"></i>
							<div class="session-info">
								<div class="device-name">{{ session.deviceName }}</div>
								<div class="session-meta">
									<code class="ip _monospace">{{ session.ip }}</code>
									<span v-if="session.location !== '-'" class="location">· {{ session.location }}</span>
								</div>
								<div class="session-time">
									<span>{{ i18n.ts.lastUsed }}: <MkTime :time="session.lastUsedAt" mode="relative"/></span>
									<span class="separator">·</span>
									<span>{{ i18n.ts.createdAt }}: <MkTime :time="session.createdAt" mode="relative"/></span>
								</div>
							</div>
							<MkButton v-if="session.isCurrent" class="current-badge" small rounded disabled>
								{{ i18n.ts.currentSession }}
							</MkButton>
							<MkButton v-else danger small rounded @click="revokeSession(session.id)">
								<i class="ti ti-trash"></i> {{ i18n.ts.revoke }}
							</MkButton>
						</div>
					</div>
					<MkButton v-if="sessions.length > 1" danger rounded style="margin-top: 8px;" @click="revokeAllOtherSessions">
						<i class="ti ti-trash"></i> {{ i18n.ts.revokeAllOtherSessions }}
					</MkButton>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['regenerate', 'refresh', 'reset', 'token']">
			<FormSection>
				<FormSlot>
					<MkButton danger @click="regenerateToken"><i class="ti ti-refresh"></i> <SearchLabel>{{ i18n.ts.regenerateLoginToken }}</SearchLabel></MkButton>
					<template #caption>{{ i18n.ts.regenerateLoginTokenDescription }}</template>
				</FormSlot>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, markRaw, onMounted, ref } from 'vue';
import X2fa from './2fa.vue';
import FormSection from '@/components/form/section.vue';
import FormSlot from '@/components/form/slot.vue';
import MkButton from '@/components/MkButton.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import { Paginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';
import { miLocalStorage } from '@/local-storage.js';

const paginator = markRaw(new Paginator('i/signin-history', {
	limit: 3,
}));

const sessions = ref<any[] | null>(null);

function normalizeIpData(ipData: string | string[]): string[] {
	return Array.isArray(ipData) ? ipData : [ipData];
}

function isLocationDataUnavailable(ipData: string[]): boolean {
	const unavailableValues = ['-', 'Unknown', 'MISSING_FILE', 'MISSING FILE', '', null, undefined];

	return [ipData[5], ipData[4], ipData[2]].every(value =>
		unavailableValues.includes(value as any) || value.includes('MISSING')
	);
}

function formatIpAddress(ipData: string | string[]): string {
	const normalized = normalizeIpData(ipData);
	return normalized[0] ?? '-';
}

function formatLocation(ipData: string | string[]): string {
	const normalized = normalizeIpData(ipData);
	return isLocationDataUnavailable(normalized)
		? '-'
		: `${normalized[5] ?? ''}, ${normalized[4] ?? ''}, ${normalized[2] ?? ''}`;
}

async function change() {
	const { canceled: canceled2, result: newPassword } = await os.inputText({
		title: i18n.ts.newPassword,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled2 || newPassword == null) return;

	const { canceled: canceled3, result: newPassword2 } = await os.inputText({
		title: i18n.ts.newPasswordRetype,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled3 || newPassword2 == null) return;

	if (newPassword !== newPassword2) {
		os.alert({
			type: 'error',
			text: i18n.ts.retypedNotMatch,
		});
		return;
	}

	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	os.apiWithDialog('i/change-password', {
		currentPassword: auth.result.password,
		token: auth.result.token,
		newPassword,
	});
}

async function regenerateToken() {
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	try {
		const result = await misskeyApi('i/regenerate-token', {
			password: auth.result.password,
			token: auth.result.token,
			current: false,
		});

		if (isTokenResponse(result) && $i) {
			// Update all token references immediately
			const newToken = result.token;
			$i.token = newToken;
			miLocalStorage.setItem('account', JSON.stringify($i));
			// Update token in multi-user storage to ensure account switching works
			const { store } = await import('@/store.js');
			const { host } = await import('@@/js/config.js');
			store.set('accountTokens', { ...store.s.accountTokens, [host + '/' + $i.id]: newToken });
			// Update account info in store to ensure consistency
			store.set('accountInfos', { ...store.s.accountInfos, [host + '/' + $i.id]: $i });
			console.log('Token regenerated and synchronized across all storage locations');
		}

		os.success();
		await os.alert({
			type: 'success',
			text: i18n.ts._tokenMigration.tokenRegenerated,
		});
	} catch (e) {
		const error = e as Error;
		await os.alert({
			type: 'error',
			text: error.message || i18n.ts._tokenMigration.tokenRegeneratedFailed,
		});
	}
}

async function loadSessions() {
	try {
		sessions.value = await misskeyApi('i/sessions');
	} catch (e) {
		console.error('Failed to load sessions:', e);
		sessions.value = [];
	}
}

async function revokeSession(sessionId: string) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.revokeSessionConfirm,
	});
	if (canceled) return;

	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	try {
		await misskeyApi('i/delete-session', {
			sessionId,
			password: auth.result.password,
			token: auth.result.token,
		});

		os.success();
		await loadSessions(); // Reload sessions after deletion
	} catch (e) {
		const error = e as any;
		await os.alert({
			type: 'error',
			text: error.message || i18n.ts.failedToRevokeSession,
		});
	}
}

async function revokeAllOtherSessions() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.revokeAllOtherSessionsConfirm,
	});
	if (canceled) return;

	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	try {
		const result = await misskeyApi('i/delete-all-sessions', {
			password: auth.result.password,
			token: auth.result.token,
		});

		os.success();
		await loadSessions(); // Reload sessions after deletion

		if (result.deletedCount > 0) {
			await os.alert({
				type: 'success',
				text: i18n.tsx.sessionsRevoked({ count: result.deletedCount }),
			});
		}
	} catch (e) {
		const error = e as any;
		await os.alert({
			type: 'error',
			text: error.message || i18n.ts.failedToRevokeSessions,
		});
	}
}

async function showIP(item: string | string[]) {
	const normalized = normalizeIpData(item);
	const locationText = isLocationDataUnavailable(normalized)
		? '-'
		: `${normalized[5] ?? ''}, ${normalized[4] ?? ''}, ${normalized[2] ?? ''}`;

	await os.alert({
		type: 'info',
		text: `IP: ${normalized[0] ?? '-'}\nLocation: ${locationText}`,
	});
}

onMounted(() => {
	loadSessions();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.security,
	icon: 'ti ti-lock',
}));

function isTokenResponse(result: unknown): result is { token: string } {
	return typeof result === 'object' && result !== null && typeof (result as { token?: unknown }).token === 'string';
}
</script>

<style lang="scss" scoped>
.timnmucd {
	padding: 12px;
	cursor: pointer;
	transition: background-color 0.1s ease;

	&:hover {
		background-color: var(--MI_THEME-hover);
	}

	&:first-child {
		border-top-left-radius: 6px;
		border-top-right-radius: 6px;
	}

	&:last-child {
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
	}

	&:not(:last-child) {
		border-bottom: solid 0.5px var(--MI_THEME-divider);
	}

	> header {
		position: relative;
		display: flex;
		align-items: center;

		> .icon {
			width: 1em;
			margin-right: 0.75em;

			&.succ {
				color: var(--MI_THEME-success);
			}

			&.fail {
				color: var(--MI_THEME-error);
			}
		}

		> .ip {
			flex: 1;
			min-width: 0;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-right: 12px;
		}

		> .location {
			position: absolute;
			left: 50%;
			transform: translateX(-50%);
			text-align: center;
			white-space: nowrap;
		}

		> .time {
			margin-left: auto;
			opacity: 0.7;
		}
	}
}

.session-item {
	padding: 16px;
	border-radius: 8px;

	.session-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;

		> .icon {
			font-size: 24px;
			opacity: 0.7;
			flex-shrink: 0;
			margin-top: 2px;
		}

		.session-info {
			flex: 1;
			min-width: 0;

			.device-name {
				font-weight: 600;
				margin-bottom: 4px;
				font-size: 15px;
			}

			.session-meta {
				font-size: 13px;
				opacity: 0.7;
				margin-bottom: 6px;

				.ip {
					font-size: 12px;
				}

				.location {
					margin-left: 4px;
				}
			}

			.session-time {
				font-size: 12px;
				opacity: 0.6;

				.separator {
					margin: 0 6px;
				}
			}
		}

		.current-badge {
			flex-shrink: 0;
			align-self: center;
		}
	}
}
</style>
