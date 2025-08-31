<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithAnimBg>
	<div :class="$style.formContainer">
		<div :class="$style.form">
			<div :class="$style.authContainer">
				<div :class="$style.authHeader">
					<i class="ti ti-shield-check" :class="$style.authIcon"></i>
					<h1 :class="$style.authTitle">{{ i18n.ts.authTitle }}</h1>
					<p :class="$style.authDescription">
						{{ i18n.ts.authDescription }}
					</p>
				</div>
				<MkAuthConfirm
					ref="authRoot"
					:name="name"
					:icon="logo"
					:description="description"
					:websiteUrl="websiteUrl"
					:permissions="permissions"
					:waitOnDeny="true"
					@accept="onAccept"
					@deny="onDeny"
				/>
			</div>
		</div>
	</div>
</PageWithAnimBg>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { definePage } from '@/page.js';
import MkAuthConfirm from '@/components/MkAuthConfirm.vue';
import { i18n } from '@/i18n.js';

const transactionIdMeta = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:transaction-id"]');
if (transactionIdMeta) {
	transactionIdMeta.remove();
}

const name = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:client-name"]')?.content;
const logo = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:client-logo"]')?.content;
const description = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:client-description"]')?.content;
const websiteUrl = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:client-website"]')?.content;
const permissions = window.document.querySelector<HTMLMetaElement>('meta[name="misskey:oauth:scope"]')?.content.split(' ').filter((p): p is typeof Misskey.permissions[number] => (Misskey.permissions as readonly string[]).includes(p)) ?? [];

function doPost(token: string, decision: 'accept' | 'deny') {
	const form = window.document.createElement('form');
	form.action = '/oauth/decision';
	form.method = 'post';
	form.acceptCharset = 'utf-8';

	const loginToken = window.document.createElement('input');
	loginToken.type = 'hidden';
	loginToken.name = 'login_token';
	loginToken.value = token;
	form.appendChild(loginToken);

	const transactionId = window.document.createElement('input');
	transactionId.type = 'hidden';
	transactionId.name = 'transaction_id';
	transactionId.value = transactionIdMeta?.content ?? '';
	form.appendChild(transactionId);

	if (decision === 'deny') {
		const cancel = window.document.createElement('input');
		cancel.type = 'hidden';
		cancel.name = 'cancel';
		cancel.value = 'cancel';
		form.appendChild(cancel);
	}

	window.document.body.appendChild(form);
	form.submit();
}

function onAccept(token: string) {
	doPost(token, 'accept');
}

function onDeny(token: string) {
	doPost(token, 'deny');
}

definePage(() => ({
	title: 'OAuth',
	icon: 'ti ti-apps',
}));
</script>

<style lang="scss" module>
.formContainer {
	min-height: 100svh;
	padding: 32px 32px calc(env(safe-area-inset-bottom, 0px) + 32px) 32px;
	box-sizing: border-box;
	display: grid;
	place-content: center;
}

.form {
	position: relative;
	z-index: 10;
	border-radius: var(--MI-radius);
	background-color: var(--MI_THEME-panel);
	box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
	overflow: clip;
	max-width: 500px;
	width: calc(100vw - 64px);
	height: min(65svh, calc(100svh - calc(env(safe-area-inset-bottom, 0px) + 64px)));
	overflow-y: scroll;
}

.authContainer {
	position: relative;
}

.authHeader {
	text-align: center;
	padding: 24px 24px 8px 24px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	margin-bottom: 16px;
}

.authIcon {
	display: block;
	font-size: 48px;
	color: var(--MI_THEME-accent);
	margin: 0 auto 16px;
	width: 48px;
	height: 48px;
}

.authTitle {
	font-size: 20px;
	font-weight: 700;
	color: var(--MI_THEME-fg);
	margin: 0 0 8px 0;
}

.authDescription {
	font-size: 14px;
	color: var(--MI_THEME-fgTransparentWeak);
	margin: 0;
	line-height: 1.5;
}
</style>
