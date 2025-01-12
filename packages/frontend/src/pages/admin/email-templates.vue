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
					<MkSwitch :modelValue="enableEmailTemplates" @update:modelValue="onChange_enableEmailTemplates">
						<template #label>{{ i18n.ts._emailTemplates.global }}</template>
						<template #caption>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i> {{ i18n.ts._emailTemplates.globalDescription }}</div>
							<div class="formatted-global-vars">
								{{ i18n.ts._emailTemplates.globalVars }}
							</div>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i><b> {{ i18n.ts._emailTemplates.globalEditWarning }} </b></div>
						</template>
					</MkSwitch>

					<div v-if="enableEmailTemplates">
						<div v-for="(folder, index) in folderConfigs" :key="index" class="_gaps">
							<MkFolder>
								<template #icon><i class="ti ti-message-exclamation"></i></template>
								<template #label>{{ folder.label }}</template>

								<div class="_gaps">
									<MkSwitch :modelValue="folder.enabled" @update:modelValue="(newValue) => onSwitchChange(index, newValue)">
										<template #label>{{ i18n.ts._emailTemplates.singleSwitch }}</template>
										<template #caption>
											<div>{{ i18n.ts._emailTemplates.singleSwitchDescription }}</div>
										</template>
									</MkSwitch>

									<div v-if="folder.enabled">
										<MkInput v-model="folder.value[0]">
											<template #caption>{{ i18n.ts._emailTemplates.title }}</template>
										</MkInput>
										<MkTextarea v-model="folder.value[1]" :placeholder="i18n.ts._emailTemplates.textareaDescription">
										</MkTextarea>
										<div class="formatted-single-vars">{{ folder.description || '' }}</div>
									</div>
									<MkButton primary @click="saveFolder(index)">{{ i18n.ts.save }}</MkButton>
								</div>
							</MkFolder>
							<br/>
						</div>
					</div>
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
import MkTextarea from '@/components/MkTextarea.vue';
import FormSuspense from '@/components/form/suspense.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInput from "@/components/MkInput.vue";

const enableEmailTemplates = ref<boolean>(false);

const folderConfigs = ref<Array<{
	label: string;
	value: string[];
	enabled: boolean;
	description?: string;
	apiKey: string;
}>>([
	{
		label: i18n.ts._emailTemplates.newLogin,
		value: [''],
		enabled: false,
		apiKey: 'newLogin',
	},
	{
		label: i18n.ts._emailTemplates.abuseReport,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.abuseReportVars,
		apiKey: 'abuseReport',
	},
	{
		label: i18n.ts._emailTemplates.resetPassword,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.resetPasswordVars,
		apiKey: 'resetPassword',
	},
	{
		label: i18n.ts._emailTemplates.accountDelete,
		value: [''],
		enabled: false,
		apiKey: 'accountDelete',
	},
	{
		label: i18n.ts._emailTemplates.inactivityWarning,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.inactivityWarningVars,
		apiKey: 'inactivityWarning',
	},
	{
		label: i18n.ts._emailTemplates.changeToApproval,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.changeToApprovalVars,
		apiKey: 'changeToApproval',
	},
	{
		label: i18n.ts._emailTemplates.signup,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.signupVars,
		apiKey: 'signup',
	},
	{
		label: i18n.ts._emailTemplates.emailVerification,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.emailVerificationVars,
		apiKey: 'emailVerification',
	},
	{
		label: i18n.ts._emailTemplates.accountApproved,
		value: [''],
		enabled: false,
		apiKey: 'accountApproved',
	},
	{
		label: i18n.ts._emailTemplates.accountSuspended,
		value: [''],
		enabled: false,
		apiKey: 'accountSuspended',
	},
	{
		label: i18n.ts._emailTemplates.approvalPending,
		value: [''],
		enabled: false,
		apiKey: 'approvalPending',
	},
	{
		label: i18n.ts._emailTemplates.newUserApprovalWithoutEmail,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.newUserApprovalWithoutEmailVars,
		apiKey: 'newUserApprovalWithoutEmail',
	},
	{
		label: i18n.ts._emailTemplates.newUserApproval,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.newUserApproval,
		apiKey: 'newUserApproval',
	},
	{
		label: i18n.ts._emailTemplates.accountReinstated,
		value: [''],
		enabled: false,
		apiKey: 'accountReinstated',
	},
	{
		label: i18n.ts._emailTemplates.accountDeclined,
		value: [''],
		enabled: false,
		apiKey: 'accountDeclined',
	},
	{
		label: i18n.ts._emailTemplates.accountDeclinedWithReason,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.accountDeclinedWithReasonVars,
		apiKey: 'accountDeclinedWithReason',
	},
	{
		label: i18n.ts._emailTemplates.newFollower,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.newFollowerVars,
		apiKey: 'newFollower',
	},
	{
		label: i18n.ts._emailTemplates.newFollowRequest,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.newFollowRequestVars,
		apiKey: 'newFollowRequest',
	},
	{
		label: i18n.ts._emailTemplates.secRelease,
		value: [''],
		enabled: false,
		description: i18n.ts._emailTemplates.secReleaseVars,
		apiKey: 'secRelease',
	},
]);

async function init() {
	const meta = await misskeyApi('admin/meta');
	enableEmailTemplates.value = meta.enableEmailTemplates;
	const templates = await misskeyApi('admin/email/templates/show');
	folderConfigs.value.forEach((folder) => {
		const content = templates.find(template => template.key === folder.apiKey) || {};
		folder.value = Array.isArray(content.content) ? content.content : [];
		folder.enabled = content.enabled || false;
	});
}

async function onChange_enableEmailTemplates(value: boolean) {
	if (value) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts.acknowledgeNotesAndEnable,
		});
		if (canceled) return;
	}

	enableEmailTemplates.value = value;

	os.apiWithDialog('admin/update-meta', {
		enableEmailTemplates: value,
	}).then(() => {
	});
}

function onSwitchChange(index: number, newValue: boolean) {
	folderConfigs.value[index].enabled = newValue;
}

function saveFolder(index: number) {
	const folder = folderConfigs.value[index];
	const templateData = {
		key: folder.apiKey,
		content: folder.value,
		enabled: folder.enabled
	};
	os.apiWithDialog('admin/email/templates/update', {
		templates: [templateData]
	}).then(() => {
	});
}

const headerTabs = computed(() => []);

definePageMetadata(() => ({
	title: i18n.ts.emailTemplates,
	icon: 'ti ti-mail',
}));
</script>

<style lang="scss" scoped>
.formatted-global-vars {
	white-space: pre-line;
}

.formatted-single-vars {
	white-space: pre-line;
}
</style>
