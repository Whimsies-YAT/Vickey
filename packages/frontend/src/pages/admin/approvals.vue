<!--
SPDX-FileCopyrightText: syuilo and other misskey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<PageWithHeader :actions="headerActions" :tabs="headerTabs">
		<MkSpacer :contentMax="900">
			<div class="_gaps_m">
				<MkPagination ref="paginationComponent" :paginator="paginator">
					<template #default="{ items }">
						<div class="_gaps_s">
							<MkApprovalUser v-for="item in items" :key="item.id" :user="(item as Misskey.entities.User)" :onDeleted="deleted"/>
						</div>
					</template>
				</MkPagination>
			</div>
		</MkSpacer>
	</PageWithHeader>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw } from 'vue';
import type * as Misskey from 'misskey-js';
import MkPagination from '@/components/MkPagination.vue';
import MkApprovalUser from '@/components/MkApprovalUser.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const paginator = markRaw(new Paginator('admin/show-pendings', {
	limit: 10,
	computedParams: computed(() => ({
		sort: '+createdAt',
	})),
	offsetMode: true,
}));

function deleted(id: string) {
	paginator.items.value = paginator.items.value.filter(item => item.id !== id);
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(computed(() => ({
	title: i18n.ts.signupPendingApprovals,
	icon: 'ti ti-user-check',
})));
</script>

<style lang="scss" module>
.inputs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.input {
	flex: 1;
}
</style>
