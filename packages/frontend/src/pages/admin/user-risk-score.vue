<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<div :class="$style.inputs">
				<MkInput v-model="userId" style="flex: 1;" type="text" :spellcheck="false">
					<template #label>{{ i18n.ts.userId }}</template>
				</MkInput>
				<MkButton primary @click="getRiskScore">{{ i18n.ts.lookup }}</MkButton>
			</div>

			<div v-if="riskScore" class="_gaps_m">
				<MkInfo>
					<div>{{ i18n.ts.totalScore }}: {{ riskScore.totalScore }}/100</div>
					<div>{{ i18n.ts.riskLevel }}: <span :class="getRiskLevelClass(riskScore.riskLevel)">{{ translateRiskLevel(riskScore.riskLevel) }}</span></div>
					<div>{{ i18n.ts.calculatedAt }}: {{ dateString(riskScore.calculatedAt) }}</div>
				</MkInfo>

				<div class="_card">
					<div class="_title">{{ i18n.ts.scoreDetails }}</div>
					<div class="_content">
						<div class="_gaps_s">
							<div class="score-item">
								<div class="label">{{ i18n.ts.profileScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.profileScore) }}/100</div>
							</div>
							<div class="score-item">
								<div class="label">{{ i18n.ts.activityScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.activityScore) }}/100</div>
							</div>
							<div class="score-item">
								<div class="label">{{ i18n.ts.relationshipScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.relationshipScore) }}/100</div>
							</div>
							<div class="score-item">
								<div class="label">{{ i18n.ts.contentScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.contentScore) }}/100</div>
							</div>
							<div class="score-item">
								<div class="label">{{ i18n.ts.engagementScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.engagementScore) }}/100</div>
							</div>
							<div class="score-item">
								<div class="label">{{ i18n.ts.multiAccountScore }}</div>
								<div class="value">{{ Math.round(riskScore.details.multiAccountScore) }}/100</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div v-if="error" class="error">
				<MkInfo warn>{{ error }}</MkInfo>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { dateString } from '@/filters/date.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const userId = ref('');
const riskScore = ref<any>(null);
const error = ref('');

async function getRiskScore() {
	if (!userId.value.trim()) {
		error.value = i18n.ts.requireUserId;
		return;
	}

	try {
		error.value = '';
		riskScore.value = null;

		riskScore.value = await misskeyApi('admin/users/get-risk-score', {
			userId: userId.value.trim(),
		});
	} catch (err: any) {
		error.value = err.message || i18n.ts.failedToFetchRiskScore;
		riskScore.value = null;
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

definePage(() => ({
	title: i18n.ts.userRiskScore,
	icon: 'ti ti-shield-check',
}));
</script>

<style lang="scss" module>
.inputs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: end;
}
</style>

<style lang="scss" scoped>
.score-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px 0;
	border-bottom: 1px solid var(--MI_THEME-divider);

	&:last-child {
		border-bottom: none;
	}

	.label {
		font-weight: bold;
	}

	.value {
		font-family: monospace;
	}
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

.error {
	margin-top: 16px;
}
</style>
