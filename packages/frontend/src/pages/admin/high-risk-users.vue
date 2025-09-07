<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<div :class="$style.inputs">
				<MkSelect v-model="riskLevel" style="flex: 1;">
					<template #label>{{ i18n.ts.riskLevel }}</template>
					<option value="">{{ i18n.ts.all }} (Poor & Fair)</option>
					<option value="poor">{{ i18n.ts._riskLevel.poor }}</option>
					<option value="fair">{{ i18n.ts._riskLevel.fair }}</option>
				</MkSelect>
				<MkInput v-model="limit" style="flex: 1;" type="number" :min="1" :max="100">
					<template #label>{{ i18n.ts.limit }}</template>
				</MkInput>
				<MkButton primary @click="loadHighRiskUsers">{{ i18n.ts.search }}</MkButton>
			</div>

			<div v-if="loading" class="loading">
				<MkInfo>{{ i18n.ts.loading }}</MkInfo>
			</div>

			<div v-if="users && users.length > 0" class="_gaps_m">
				<div class="stats">
					<MkInfo>{{ i18n.tsx._highRisk.foundUsers({ length: users.length }) }}</MkInfo>
				</div>

				<div :class="$style.users">
					<div v-for="userItem in users" :key="userItem.user.id" :class="$style.userCard">
						<div class="user-header">
							<MkA :to="`/admin/user/${userItem.user.id}`" class="user-link">
								<MkUserCardMini :user="userItem.user"/>
							</MkA>
						</div>

						<div class="risk-info">
							<div class="risk-score">
								<span class="label">{{ i18n.ts.riskScore }}</span>
								<span :class="getRiskScoreClass(userItem.totalScore)" class="score">
									{{ userItem.totalScore }}/100
								</span>
							</div>
							<div class="risk-level">
								<span class="label">{{ i18n.ts.riskLevel }}</span>
								<span :class="getRiskLevelClass(userItem.riskLevel)" class="level">
									{{ translateRiskLevel(userItem.riskLevel) }}
								</span>
							</div>
							<div class="calculated-at">
								<span class="label">{{ i18n.ts.calculatedAt }}</span>
								<span class="date">{{ dateString(userItem.calculatedAt) }}</span>
							</div>
						</div>

						<div class="actions">
							<MkButton @click="viewRiskDetails" size="sm">
								{{ i18n.ts.details }}
							</MkButton>
						</div>
					</div>
				</div>

				<div v-if="users.length >= limit" class="pagination-note">
					<MkInfo>{{ i18n.tsx._highRisk.showResults({ limit }) }}</MkInfo>
				</div>
			</div>

			<div v-else-if="searched && users?.length === 0" class="no-users">
				<MkInfo>{{ i18n.ts._highRisk.notFound }}</MkInfo>
			</div>

			<div v-if="error" class="error">
				<MkInfo warn>{{ error }}</MkInfo>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { dateString } from '@/filters/date.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

const riskLevel = ref('');
const limit = ref(20);
const users = ref<any[]>([]);
const searched = ref(false);
const loading = ref(false);
const error = ref('');

async function loadHighRiskUsers() {
	try {
		error.value = '';
		loading.value = true;
		searched.value = false;

		const params: any = {
			limit: limit.value,
			offset: 0,
		};

		if (riskLevel.value) {
			params.riskLevel = riskLevel.value;
		}

		const result = await misskeyApi('admin/users/list-high-risk-users', params);

		users.value = result || [];
		searched.value = true;
	} catch (err: any) {
		error.value = err.message || i18n.ts._highRisk.failedToLoad;
		users.value = [];
		searched.value = true;
	} finally {
		loading.value = false;
	}
}

function translateRiskLevel(level: string): string {
	switch (level) {
		case 'poor': return i18n.ts._riskLevel.poor;
		case 'fair': return i18n.ts._riskLevel.fair;
		case 'good': return i18n.ts._riskLevel.good;
		case 'veryGood': return i18n.ts._riskLevel.veryGood;
		case 'excellent': return i18n.ts._riskLevel.excellent;
		default: return level;
	}
}

function getRiskLevelClass(level: string): string {
	switch (level) {
		case 'poor': return 'risk-poor';
		case 'fair': return 'risk-fair';
		case 'good': return 'risk-good';
		case 'veryGood': return 'risk-very-good';
		case 'excellent': return 'risk-excellent';
		default: return '';
	}
}

function getRiskScoreClass(score: number): string {
	if (score <= 40) return 'risk-poor';
	if (score <= 60) return 'risk-fair';
	if (score <= 75) return 'risk-good';
	if (score <= 85) return 'risk-very-good';
	return 'risk-excellent';
}

function viewRiskDetails() {
	os.pageWindow(`/admin/user-risk-score`);
}

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: i18n.ts.refresh,
	handler: loadHighRiskUsers,
}]);

definePage(() => ({
	title: i18n.ts.highRiskUsers,
	icon: 'ti ti-shield-exclamation',
}));
</script>

<style lang="scss" module>
.inputs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: end;
}

.users {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
	grid-gap: 16px;
}

.userCard {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 16px;
	background: var(--MI_THEME-panel);
}
</style>

<style lang="scss" scoped>
.user-header {
	margin-bottom: 12px;

	.user-link {
		text-decoration: none;
		color: inherit;

		&:hover {
			text-decoration: none;
		}
	}
}

.risk-info {
	margin-bottom: 12px;

	> div {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;

		&:last-child {
			margin-bottom: 0;
		}

		.label {
			font-weight: bold;
			color: var(--MI_THEME-fgTransparentWeak);
		}
	}
}

.actions {
	text-align: right;
}

.stats {
	text-align: center;
}

.pagination-note {
	text-align: center;
}

.no-users {
	text-align: center;
	padding: 40px;
}

.loading, .error {
	margin: 20px 0;
}

.risk-poor {
	color: #f85c5c;
	font-weight: bold;
}

.risk-fair {
	color: #f5a623;
	font-weight: bold;
}

.risk-good {
	color: #7ed321;
	font-weight: bold;
}

.risk-very-good {
	color: #50d71e;
	font-weight: bold;
}

.risk-excellent {
	color: #4fc3f7;
	font-weight: bold;
}

.score, .level {
	font-family: monospace;
}

.date {
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
}
</style>
