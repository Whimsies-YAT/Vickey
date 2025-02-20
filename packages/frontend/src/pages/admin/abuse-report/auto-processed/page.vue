<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<MkStickyContainer>
		<template #header><XHeader :actions="headerActions" :tabs="headerTabs"/></template>
		<MkSpacer :contentMax="900">
			<div :class="$style.root" class="_gaps">
				<MkPagination v-slot="{ items }" ref="reports" :pagination="pagination">
					<div class="_gaps">
						<MkFolder v-for="item in items">
							<template #label>{{ item.id }}</template>
							<template #icon>
								<i v-if="item.detail.status === 0" class="ti ti-info-circle"></i>
								<i v-else-if="item.detail.status === 1" class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i>
								<i v-else-if="item.detail.status === 2" class="ti ti-circle-x" style="color: var(--MI_THEME-error);"></i>
							</template>
							<div class="_gaps">
								<MkInfo>ID: {{item.detail.id}}}</MkInfo>
								<MkFolder :default-open="true">
									<template #icon><i class="ti ti-message-2"></i></template>
									<template #label>{{ i18n.ts.details }}</template>
									<Mfm :text="item.detail.note.text" :linkNavigationBehavior="'window'"/>
								</MkFolder>
								<MkFolder :default-open="true">
									<template #icon><i class="ti ti-message-2"></i></template>
									<template #label>{{ i18n.ts._abuseReportAutoProcessing.score }}</template>
									<MkInfo>{{ item.score }} ({{ item.detail.label }})</MkInfo>
								</MkFolder>
								<MkFolder :default-open="true">
									<template #icon><i class="ti ti-message-2"></i></template>
									<template #label>{{ i18n.ts._abuseReportAutoProcessing.status }}</template>
									<MkInfo>{{ i18n.ts._abuseReportAutoProcessing[ item.detail.status === 0 ? 'record' : (item.detail.status === 1 ? 'ignore' : 'delete') ]}}</MkInfo>
								</MkFolder>
							</div>
						</MkFolder>
					</div>
				</MkPagination>
			</div>
		</MkSpacer>
	</MkStickyContainer>
</template>

<script lang="ts" setup>
import { computed, shallowRef } from 'vue';
import XHeader from '../../_header_.vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import MkInfo from '@/components/MkInfo.vue';
import { defaultStore } from '@/store.js';
import * as os from "@/os";
import { misskeyApi } from "@/scripts/misskey-api";
import MkFolder from "@/components/MkFolder.vue";

const reports = shallowRef<InstanceType<typeof MkPagination>>();

const pagination = {
	endpoint: 'admin/abuse-report/auto-processed/show' as const,
	limit: 10,
};

const menu = (ev: MouseEvent) => {
	os.popupMenu([{
		icon: 'ti ti-download',
		text: i18n.ts.export,
		action: async () => {
			misskeyApi('admin/abuse-report/auto-processed/export', {
			})
				.then(() => {
					os.alert({
						type: 'info',
						text: i18n.ts.exportRequested,
					});
				}).catch((err) => {
				os.alert({
					type: 'error',
					text: err.message,
				});
			});
		},
	}], ev.currentTarget ?? ev.target);
};

const headerActions = computed(() => [{
	icon: 'ti ti-dots',
	handler: menu,
}]);

const headerTabs = computed(() => []);

definePageMetadata(() => ({
	title: i18n.ts._abuseReportAutoProcessing.title,
	icon: 'ti ti-exclamation-circle',
}));
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: stretch;
}
</style>
