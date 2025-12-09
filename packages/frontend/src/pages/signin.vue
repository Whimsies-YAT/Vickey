<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m" style="padding: 32px; max-width: 400px; margin: 0 auto;">
	<MkSignin/>
</div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import MkSignin from '@/components/MkSignin.vue';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

defineOptions({
	name: 'MkSigninPage',
});

const props = defineProps<{
	// eslint-disable-next-line vue/prop-name-casing
	sso_token?: string;
	error?: string;
}>();

onMounted(async () => {
	if (props.error) {
		os.alert({
			type: 'error',
			text: decodeURIComponent(props.error),
		});
	}

	if (props.sso_token) {
		await login(props.sso_token);
	}
});

definePage(() => ({
	title: i18n.ts.login,
	icon: 'ti ti-login',
}));
</script>
