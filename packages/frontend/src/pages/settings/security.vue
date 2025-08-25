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
									<code class="ip _monospace">{{ item.ip[0] }}</code>
									<code class="location _monospace">
										{{
											isLocationDataUnavailable(item.ip)
												? '-'
												: `${item.ip[5]}, ${item.ip[4]}, ${item.ip[2]}`
										}}
									</code>
									<MkTime :time="item.createdAt" class="time"/>
								</header>
							</div>
						</div>
					</template>
				</MkPagination>
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
import { computed, markRaw } from 'vue';
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

function isLocationDataUnavailable(ipData: string[]): boolean {
	const unavailableValues = ['-', 'Unknown', 'MISSING_FILE', 'MISSING FILE', '', null, undefined];

	return [ipData[5], ipData[4], ipData[2]].every(value =>
		unavailableValues.includes(value as any) || value.includes('MISSING')
	);
}

async function change() {
	const { canceled: canceled2, result: newPassword } = await os.inputText({
		title: i18n.ts.newPassword,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled2) return;

	const { canceled: canceled3, result: newPassword2 } = await os.inputText({
		title: i18n.ts.newPasswordRetype,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled3) return;

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

		if (result && typeof result === 'object' && 'token' in result && $i) {
			$i.token = result.token;
			miLocalStorage.setItem('account', JSON.stringify($i));
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

async function showIP(item: string[]) {
	// 使用相同的检查逻辑
	const locationText = isLocationDataUnavailable(item)
		? '-'
		: `${item[5]}, ${item[4]}, ${item[2]}`;

	await os.alert({
		type: 'info',
		text: `IP: ${item[0]}\nLocation: ${locationText}`,
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.security,
	icon: 'ti ti-lock',
}));
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
</style>
