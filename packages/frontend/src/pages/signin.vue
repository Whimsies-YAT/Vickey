<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m" style="padding: 32px; max-width: 400px; margin: 0 auto;">
	<MkAlert v-if="error" type="error">{{ decodeURIComponent(error) }}</MkAlert>

	<div v-if="sso_token" style="text-align: center;">
		<MkLoading/>
		<div style="margin-top: 16px;">{{ i18n.ts.loggingIn }}</div>
	</div>

	<MkSignin v-else-if="!$i"/>
</div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import MkSignin from '@/components/MkSignin.vue';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

defineOptions({
	name: 'MkSigninPage',
});

const props = defineProps<{
	// eslint-disable-next-line vue/prop-name-casing
	sso_token?: string;
	error?: string;
}>();

const signout = () => import('@/signout.js').then(m => m.signout());

onMounted(async () => {
	// If already logged in and not reporting an error, redirect to home.
	// We don't want to start a new session loop.
	if ($i && !props.error) {
		window.location.href = '/';
		return;
	}

	if (props.sso_token) {
		if ($i) {
			await signout();
		}

		if (new URLSearchParams(window.location.search).get('is_new_user') === 'true') {
			login(props.sso_token, '/settings/security');
		} else {
			login(props.sso_token);
		}
		return;
	}
});

definePage(() => ({
	title: i18n.ts.login,
	icon: 'ti ti-login',
}));
</script>
