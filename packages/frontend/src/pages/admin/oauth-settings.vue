<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_gaps_m">
		<div v-for="config in configs" :key="config.id" class="_panel _gaps_m" :class="$style.config">
			<div class="_gaps_s">
				<div style="font-weight: bold;">{{ config.name }}</div>
				<div style="opacity: 0.7;">{{ typeOptions.find(o => o.value === config.type)?.label ?? config.type }}</div>
			</div>

			<MkInput v-model="config.name">
				<template #label>{{ i18n.ts._oauthSettings.name }}</template>
			</MkInput>

			<MkSelect v-model="config.type" :items="typeOptions">
				<template #label>{{ i18n.ts._oauthSettings.type }}</template>
			</MkSelect>

			<FormSplit>
				<MkInput v-model="config.clientId">
					<template #label>{{ i18n.ts._oauthSettings.clientId }}</template>
				</MkInput>
				<MkInput v-model="config.clientSecret" type="password">
					<template #label>{{ i18n.ts._oauthSettings.clientSecret }}</template>
				</MkInput>
			</FormSplit>

			<MkInput v-model="config.authorizationEndpoint">
				<template #label>{{ i18n.ts._oauthSettings.authorizationEndpoint }}</template>
			</MkInput>

			<MkInput v-model="config.tokenEndpoint">
				<template #label>{{ i18n.ts._oauthSettings.tokenEndpoint }}</template>
			</MkInput>

			<MkFolder>
				<template #label>{{ i18n.ts._oauthSettings.advancedSettings }}</template>
				<div class="_gaps_m">
					<MkInput v-model="config.userInfoEndpoint">
						<template #label>{{ i18n.ts._oauthSettings.userInfoEndpoint }}</template>
					</MkInput>
					<MkInput v-model="config.issuer">
						<template #label>{{ i18n.ts._oauthSettings.issuer }}</template>
					</MkInput>
					<MkInput v-model="config.jwksUri">
						<template #label>{{ i18n.ts._oauthSettings.jwksUri }}</template>
					</MkInput>
					<MkInput v-model="config.redirectUri">
						<template #label>{{ i18n.ts._oauthSettings.redirectUri }}</template>
					</MkInput>
					<!-- Scopes handling could be improved, comma separated string for now -->
					<MkInput :modelValue="config.scope.join(' ')" @update:modelValue="config.scope = $event.split(' ')">
						<template #label>{{ i18n.ts._oauthSettings.scopes }}</template>
					</MkInput>
					<MkSwitch v-model="config.autoRegister">
						<template #label>{{ i18n.ts._oauthSettings.autoRegister }}</template>
					</MkSwitch>
					<MkSwitch v-model="config.autoUpdate">
						<template #label>{{ i18n.ts._oauthSettings.autoUpdate }}</template>
					</MkSwitch>
				</div>
			</MkFolder>

			<div class="_buttons">
				<MkButton inline primary style="margin-right: 12px;" @click="save(config)">
					<i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}
				</MkButton>
				<MkButton inline danger @click="remove(config)">
					<i class="ti ti-trash"></i> {{ i18n.ts.remove }}
				</MkButton>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import FormSplit from '@/components/form/split.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const typeOptions = computed(() => [
	{ label: i18n.ts._oauthSettings.oauth2, value: 'oauth2' },
	{ label: i18n.ts._oauthSettings.oidc, value: 'oidc' },
]);

type OAuthClientConfigStrict = Omit<Misskey.entities.OAuthClientConfig, 'userInfoEndpoint' | 'issuer' | 'jwksUri'> & {
	userInfoEndpoint: string | null;
	issuer: string | null;
	jwksUri: string | null;
};

const configs = ref<OAuthClientConfigStrict[]>([]);

function refresh() {
	misskeyApi('admin/oauth-client-config/list', {}).then(response => {
		configs.value = response.map(c => ({
			...c,
			userInfoEndpoint: c.userInfoEndpoint ?? null,
			issuer: c.issuer ?? null,
			jwksUri: c.jwksUri ?? null,
		}));
	});
}

function add() {
	configs.value.unshift({
		id: '',
		name: i18n.ts._oauthSettings.newProvider,
		type: 'oauth2',
		clientId: '',
		clientSecret: '',
		authorizationEndpoint: '',
		tokenEndpoint: '',
		userInfoEndpoint: null,
		issuer: null,
		jwksUri: null,
		scope: [],
		redirectUri: '',
		autoRegister: true,
		autoUpdate: true,
		userMapping: {},
		isActive: true,
	});
}

function remove(config: OAuthClientConfigStrict) {
	os.confirm({
		type: 'warning',
		text: i18n.tsx._oauthSettings.removeAreYouSure({ x: config.name }),
	}).then(({ canceled }) => {
		if (canceled) return;
		configs.value = configs.value.filter(x => x !== config);
		if (config.id === '') return;
		os.apiWithDialog('admin/oauth-client-config/delete', {
			id: config.id,
		}).then(() => {
			refresh();
		});
	});
}

function save(config: Misskey.entities.OAuthClientConfig) {
	const params = {
		name: config.name,
		type: config.type,
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		authorizationEndpoint: config.authorizationEndpoint,
		tokenEndpoint: config.tokenEndpoint,
		userInfoEndpoint: config.userInfoEndpoint || null,
		issuer: config.issuer || null,
		jwksUri: config.jwksUri || null,
		scope: config.scope,
		redirectUri: config.redirectUri,
		autoRegister: config.autoRegister,
		autoUpdate: config.autoUpdate,
		userMapping: config.userMapping,
	};

	if (config.id === '') {
		misskeyApi('admin/oauth-client-config/create', params).then(() => {
			os.alert({
				type: 'success',
				text: i18n.ts._oauthSettings.saved,
			});
			refresh();
		}).catch(err => {
			os.alert({
				type: 'error',
				text: err,
			});
		});
	} else {
		misskeyApi('admin/oauth-client-config/update', {
			id: config.id, // NOTE: api expects 'id' in paramDef, but moderation log uses 'oauthClientConfigId'. Wait, update endpoint paramDef has 'id'.
			// Check update.ts paramDef: 'id' is required.
			// Previous code had: oauthClientConfigId: config.id
			// This was WRONG in my previous edit! update endpoint expects 'id'.
			...params,
		}).then(() => {
			os.alert({
				type: 'success',
				text: i18n.ts._oauthSettings.saved,
			});
		}).catch(err => {
			os.alert({
				type: 'error',
				text: err,
			});
		});
	}
}

refresh();

const headerActions = computed(() => [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.add,
	handler: add,
}]);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._oauthSettings.title,
	icon: 'ti ti-settings',
}));
</script>

<style lang="scss" module>
.config {
	padding: 32px;
}
</style>
