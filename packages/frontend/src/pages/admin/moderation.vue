<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<MkStickyContainer>
		<template #header><XHeader :tabs="headerTabs"/></template>
		<MkSpacer :contentMax="700" :marginMin="16" :marginMax="32">
			<FormSuspense :p="init">
				<div class="_gaps_m">
					<MkSwitch :modelValue="enableRegistration" @update:modelValue="onChange_enableRegistration">
						<template #label>{{ i18n.ts._serverSettings.openRegistration }}</template>
						<template #caption>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i> {{ i18n.ts._serverSettings.openRegistrationWarning }}</div>
						</template>
					</MkSwitch>

					<MkSwitch v-model="emailRequiredForSignup" @change="onChange_emailRequiredForSignup">
						<template #label>{{ i18n.ts.emailRequiredForSignup }}</template>
					</MkSwitch>

					<MkSwitch v-model="approvalRequiredForSignup" @change="onChange_approvalRequiredForSignup">
						<template #label>{{ i18n.ts.approvalRequiredForSignup }}</template>
						<template #caption>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i>{{ i18n.ts._serverSettings.thisSettingWillAutomaticallyOnWhenModeratorsInactive }}</div>
							{{ i18n.ts.registerApprovalEmailRecommended }}
						</template>
					</MkSwitch>

					<FormLink to="/admin/server-rules">{{ i18n.ts.serverRules }}</FormLink>

					<MkFolder>
						<template #icon><i class="ti ti-lock-star"></i></template>
						<template #label>{{ i18n.ts.preservedUsernames }}</template>

						<div class="_gaps">
							<MkTextarea v-model="preservedUsernames">
								<template #caption>{{ i18n.ts.preservedUsernamesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_preservedUsernames">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-message-exclamation"></i></template>
						<template #label>{{ i18n.ts.sensitiveWords }}</template>

						<div class="_gaps">
							<MkTextarea v-model="sensitiveWords">
								<template #caption>{{ i18n.ts.sensitiveWordsDescription }}<br>{{ i18n.ts.sensitiveWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_sensitiveWords">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-message-x"></i></template>
						<template #label>{{ i18n.ts.prohibitedWords }}</template>

						<div class="_gaps">
							<MkTextarea v-model="prohibitedWords">
								<template #caption>{{ i18n.ts.prohibitedWordsDescription }}<br>{{ i18n.ts.prohibitedWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_prohibitedWords">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-user-x"></i></template>
						<template #label>{{ i18n.ts.prohibitedWordsForNameOfUser }}</template>

						<div class="_gaps">
							<MkTextarea v-model="prohibitedWordsForNameOfUser">
								<template #caption>{{ i18n.ts.prohibitedWordsForNameOfUserDescription }}<br>{{ i18n.ts.prohibitedWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_prohibitedWordsForNameOfUser">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-eye-off"></i></template>
						<template #label>{{ i18n.ts.hiddenTags }}</template>

						<div class="_gaps">
							<MkTextarea v-model="hiddenTags">
								<template #caption>{{ i18n.ts.hiddenTagsDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_hiddenTags">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-eye-off"></i></template>
						<template #label>{{ i18n.ts.silencedInstances }}</template>

						<div class="_gaps">
							<MkTextarea v-model="silencedHosts">
								<template #caption>{{ i18n.ts.silencedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_silencedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-eye-off"></i></template>
						<template #label>{{ i18n.ts.mediaSilencedInstances }}</template>

						<div class="_gaps">
							<MkTextarea v-model="mediaSilencedHosts">
								<template #caption>{{ i18n.ts.mediaSilencedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_mediaSilencedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-ban"></i></template>
						<template #label>{{ i18n.ts.blockedInstances }}</template>

						<div class="_gaps">
							<MkTextarea v-model="blockedHosts">
								<template #caption>{{ i18n.ts.blockedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_blockedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>

					<MkFolder>
						<template #icon><i class="ti ti-info-circle"></i></template>
						<template #label>{{ i18n.ts.abuseReportAutoProcessing }}<span class="_beta">{{ i18n.ts.beta }}</span></template>

						<div class="_gaps">
							<MkSwitch v-model="abuseMLCheck">
								<template #label>{{ i18n.ts._abuseReportAutoProcessing.enable }}</template>
							</MkSwitch>
							<div v-if="abuseMLCheck">
								<span>{{ i18n.ts._sensitiveMediaDetection.description }}</span>
								<MkRadios v-model="abuseReportMLAction">
									<option value="record">{{ i18n.ts._abuseReportAutoProcessing.record }}</option>
									<option value="ignore">{{ i18n.ts._abuseReportAutoProcessing.ignore }} ({{i18n.ts.recommended}})</option>
									<option value="delete">{{ i18n.ts._abuseReportAutoProcessing.delete }}</option>
								</MkRadios>
								<MkInput v-model="abuseMLInfoUrl">
									<template #label>{{i18n.ts._abuseReportAutoProcessing.url}}</template>
								</MkInput>
								<MkInput v-model="abuseMLInfoToken">
									<template #label>{{i18n.ts._abuseReportAutoProcessing.token}}</template>
								</MkInput>
								<MkInput v-model.number="abuseMLInfoScore" type="range" :min="0" :max="1" :step="0.01">
									<template #label>{{i18n.ts._abuseReportAutoProcessing.score}}: {{ abuseMLInfoScore }}</template>
								</MkInput>
							</div>
							<MkButton primary @click="save_abuseReportAutoProcessing">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</div>
			</FormSuspense>
		</MkSpacer>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import XHeader from './_header_.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import FormSuspense from '@/components/form/suspense.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import MkButton from '@/components/MkButton.vue';
import FormLink from '@/components/form/link.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkRadios from "@/components/MkRadios.vue";

const enableRegistration = ref<boolean>(false);
const emailRequiredForSignup = ref<boolean>(false);
const approvalRequiredForSignup = ref<boolean>(false);
const sensitiveWords = ref<string>('');
const prohibitedWords = ref<string>('');
const prohibitedWordsForNameOfUser = ref<string>('');
const hiddenTags = ref<string>('');
const preservedUsernames = ref<string>('');
const blockedHosts = ref<string>('');
const silencedHosts = ref<string>('');
const mediaSilencedHosts = ref<string>('');
const abuseMLCheck = ref<boolean>(false);
const abuseReportMLAction = ref<string>('record');
const abuseMLInfoUrl = ref<string>('');
const abuseMLInfoToken = ref<string>('');
const abuseMLInfoScore = ref<number>(0.5);

async function init() {
	const meta = await misskeyApi('admin/meta');
	enableRegistration.value = !meta.disableRegistration;
	emailRequiredForSignup.value = meta.emailRequiredForSignup;
	approvalRequiredForSignup.value = meta.approvalRequiredForSignup;
	sensitiveWords.value = meta.sensitiveWords.join('\n');
	prohibitedWords.value = meta.prohibitedWords.join('\n');
	prohibitedWordsForNameOfUser.value = meta.prohibitedWordsForNameOfUser.join('\n');
	hiddenTags.value = meta.hiddenTags.join('\n');
	preservedUsernames.value = meta.preservedUsernames.join('\n');
	blockedHosts.value = meta.blockedHosts.join('\n');
	silencedHosts.value = meta.silencedHosts?.join('\n') ?? '';
	mediaSilencedHosts.value = meta.mediaSilencedHosts.join('\n');
	abuseMLCheck.value = meta.abuseMLCheck;
	abuseReportMLAction.value = meta.abuseReportMLAction;
	abuseMLInfoUrl.value = meta.abuseMLInfoUrl;
	abuseMLInfoToken.value = meta.abuseMLInfoToken;
	abuseMLInfoScore.value = meta.abuseMLInfoScore;
}

async function onChange_enableRegistration(value: boolean) {
	if (value) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts.acknowledgeNotesAndEnable,
		});
		if (canceled) return;
	}

	enableRegistration.value = value;

	os.apiWithDialog('admin/update-meta', {
		disableRegistration: !value,
	}).then(() => {
		fetchInstance(true);
	});
}

function onChange_emailRequiredForSignup(value: boolean) {
	os.apiWithDialog('admin/update-meta', {
		emailRequiredForSignup: value,
	}).then(() => {
		fetchInstance(true);
	});
}

function onChange_approvalRequiredForSignup(value: boolean) {
	os.apiWithDialog('admin/update-meta', {
		approvalRequiredForSignup: value,
	}).then(() => {
		fetchInstance(true);
	});
}

function save_preservedUsernames() {
	os.apiWithDialog('admin/update-meta', {
		preservedUsernames: preservedUsernames.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_sensitiveWords() {
	os.apiWithDialog('admin/update-meta', {
		sensitiveWords: sensitiveWords.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_prohibitedWords() {
	os.apiWithDialog('admin/update-meta', {
		prohibitedWords: prohibitedWords.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_prohibitedWordsForNameOfUser() {
	os.apiWithDialog('admin/update-meta', {
		prohibitedWordsForNameOfUser: prohibitedWordsForNameOfUser.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_hiddenTags() {
	os.apiWithDialog('admin/update-meta', {
		hiddenTags: hiddenTags.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_blockedHosts() {
	os.apiWithDialog('admin/update-meta', {
		blockedHosts: blockedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

function save_silencedHosts() {
	os.apiWithDialog('admin/update-meta', {
		silencedHosts: silencedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

function save_mediaSilencedHosts() {
	os.apiWithDialog('admin/update-meta', {
		mediaSilencedHosts: mediaSilencedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

function save_abuseReportAutoProcessing() {
	os.apiWithDialog('admin/update-meta', {
		abuseMLCheck: abuseMLCheck.value,
		abuseReportMLAction: abuseReportMLAction.value,
		abuseMLInfoUrl: abuseMLInfoUrl.value,
		abuseMLInfoToken: abuseMLInfoToken.value,
		abuseMLInfoScore: Number(abuseMLInfoScore.value),
	}).then(() => {
		fetchInstance(true);
	});
}

const headerTabs = computed(() => []);

definePageMetadata(() => ({
	title: i18n.ts.moderation,
	icon: 'ti ti-shield',
}));
</script>
