<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/connect" :label="i18n.ts._settings.serviceConnection" :keywords="['app', 'service', 'connect', 'webhook', 'api', 'token']" icon="ti ti-link">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/client-assets/link_3d.png" color="#ff0088">
			<SearchText>{{ i18n.ts._settings.serviceConnectionBanner }}</SearchText>
		</MkFeatureBanner>

		<SearchMarker :keywords="['sso', 'login', 'social', 'oauth']">
			<FormSection>
				<template #label><i class="ti ti-login-2"></i> <SearchLabel>SSO</SearchLabel></template>

				<div class="_gaps_m">
					<div v-for="provider in providers" :key="provider.id" class="_gaps_s" style="display: flex; align-items: center; justify-content: space-between;">
						<div style="font-weight: bold;">{{ provider.name }}</div>
						<div v-if="linkedSso?.ssoProviderId === provider.id">
							<MkButton type="button" danger @click="disconnectSso()">
								<i class="ti ti-unlink"></i> {{ i18n.ts.disconnect }}
							</MkButton>
						</div>
						<div v-else>
							<MkButton type="button" primary @click="connectSso(provider)">
								<i class="ti ti-link"></i> {{ i18n.ts.connect }}
							</MkButton>
						</div>
					</div>
					<div v-if="providers.length === 0" style="opacity: 0.7;">
						{{ i18n.ts.noProviders }}
					</div>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['api', 'app', 'token', 'accessToken']">
			<FormSection>
				<template #label><i class="ti ti-api"></i> <SearchLabel>{{ i18n.ts._settings.api }}</SearchLabel></template>

				<div class="_gaps_m">
					<MkButton primary @click="generateToken">{{ i18n.ts.generateAccessToken }}</MkButton>
					<FormLink to="/settings/apps">{{ i18n.ts.manageAccessTokens }}</FormLink>
					<FormLink to="/api-console" :behavior="isDesktop ? 'window' : null">API console</FormLink>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['webhook']">
			<FormSection>
				<template #label><i class="ti ti-webhook"></i> <SearchLabel>{{ i18n.ts._settings.webhook }}</SearchLabel></template>

				<div class="_gaps_m">
					<FormLink :to="`/settings/webhook/new`">
						{{ i18n.ts._webhookSettings.createWebhook }}
					</FormLink>

					<MkFolder :defaultOpen="true">
						<template #label>{{ i18n.ts.manage }}</template>

						<MkPagination :paginator="paginator" withControl>
							<template #default="{items}">
								<div class="_gaps">
									<FormLink v-for="webhook in items" :key="webhook.id" :to="`/settings/webhook/edit/${webhook.id}`">
										<template #icon>
											<i v-if="webhook.active === false" class="ti ti-player-pause"></i>
											<i v-else-if="webhook.latestStatus === null" class="ti ti-circle"></i>
											<i v-else-if="[200, 201, 204].includes(webhook.latestStatus)" class="ti ti-check" :style="{ color: 'var(--MI_THEME-success)' }"></i>
											<i v-else class="ti ti-alert-triangle" :style="{ color: 'var(--MI_THEME-error)' }"></i>
										</template>
										{{ webhook.name || webhook.url }}
										<template #suffix>
											<MkTime v-if="webhook.latestSentAt" :time="webhook.latestSentAt"></MkTime>
										</template>
									</FormLink>
								</div>
							</template>
						</MkPagination>
					</MkFolder>
				</div>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, ref, defineAsyncComponent, markRaw, onMounted } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import FormSection from '@/components/form/section.vue';
import FormLink from '@/components/form/link.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import { Paginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';

const isDesktop = ref(window.innerWidth >= 1100);

type SsoProvider = {
	id: string;
	name: string;
	type: string;
	iconUrl: string | null;
};

type LinkedSso = {
	ssoProviderId: string | null;
	ssoId: string | null;
};

const providers = ref<SsoProvider[]>([]);
const linkedSso = ref<LinkedSso | null>(null);

onMounted(() => {
	misskeyApi('sso/providers').then(res => {
		providers.value = res as SsoProvider[];
	});
	updateLinkedSso();
});

function updateLinkedSso() {
	misskeyApi('i/authorized-sso' as any).then(res => {
		linkedSso.value = res as LinkedSso;
	});
}

async function connectSso(provider: SsoProvider) {
	try {
		const res = await window.fetch(`/sso/connect/${provider.id}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				token: $i?.token,
			}),
		});

		if (res.ok) {
			const { url } = await res.json();
			window.location.href = url;
		} else {
			const { error } = await res.json();
			os.alert({
				type: 'error',
				text: error,
			});
		}
	} catch (e) {
		os.alert({
			type: 'error',
			text: 'Failed to connect: ' + e,
		});
	}
}

async function disconnectSso() {
	const { canceled, result } = await os.authenticateDialog();
	if (canceled) return;

	try {
		await misskeyApi('i/disconnect-sso' as any, {
			password: result.password,
			token: result.token,
		});
		os.success();
		updateLinkedSso();
	} catch (err: any) {
		os.alert({
			type: 'error',
			text: err.message,
		});
	}
}

const paginator = markRaw(new Paginator('i/webhooks/list', {
	limit: 100,
	noPaging: true,
}));

async function generateToken() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkTokenGenerateWindow.vue').then(x => x.default), {}, {
		done: async result => {
			const { name, permissions } = result;
			const { token } = await misskeyApi('miauth/gen-token', {
				session: null,
				name: name,
				permission: permissions,
			});

			os.alert({
				type: 'success',
				title: i18n.ts.token,
				text: token,
			});
		},
		closed: () => dispose(),
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._settings.serviceConnection,
	icon: 'ti ti-link',
}));
</script>
