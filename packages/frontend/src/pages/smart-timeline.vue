<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="currentTab" :actions="headerActions" :tabs="headerTabs" :displayMyAvatar="true">
	<template #header>
		<div :class="$style.header">
			<div :class="$style.title">
				<i class="ti ti-sparkles"></i>
				<span>{{ i18n.ts.smartTimeline }}</span>
			</div>
			<div v-if="analytics" :class="$style.analytics">
				<div :class="$style.metric">
					<span :class="$style.metricLabel">{{ i18n.ts._smartTimeline.cacheHitRate }}</span>
					<span :class="$style.metricValue">{{ Math.round(analytics.performanceMetrics.cacheHitRate * 100) }}%</span>
				</div>
				<div :class="$style.metric">
					<span :class="$style.metricLabel">{{ i18n.ts._smartTimeline.diversity }}</span>
					<span :class="$style.metricValue">{{ Math.round(analytics.performanceMetrics.contentDiversity * 100) }}%</span>
				</div>
			</div>
		</div>
	</template>

	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div v-if="currentTab === 'smart'">
			<MkTip k="tl.home" style="margin-bottom: var(--MI-margin);">
				{{ i18n.ts._smartTimeline.timelineDesc }}
			</MkTip>

			<MkPostForm v-if="prefer.r.showFixedPostForm.value" :class="$style.postForm" class="_panel" fixed style="margin-bottom: var(--MI-margin);"/>

			<MkSmartTimeline
				ref="smartTimelineRef"
				:algorithm="preferences.algorithm"
				:diversityLevel="preferences.diversityLevel"
				:freshnessWeight="preferences.freshnessWeight"
				:qualityThreshold="preferences.qualityThreshold"
				:showModeIndicator="true"
				:showScoreIndicator="preferences.showScoreIndicator"
				:autoRefresh="true"
				@note="onNote"
			/>
		</div>

		<div v-else-if="currentTab === 'recommended'">
			<MkTip k="tl.home" style="margin-bottom: var(--MI-margin);">
				{{ i18n.ts._smartTimeline.recommendedDesc }}
			</MkTip>

			<MkRecommendedTimeline
				ref="recommendedTimelineRef"
				:diversityFactor="0.7"
				:qualityThreshold="0.5"
			/>
		</div>

		<div v-else-if="currentTab === 'settings'">
			<div :class="$style.settingsContainer">
				<div style="padding: 20px 28px;">
					<div class="_gaps_m">
						<MkFolder>
							<template #label>{{ i18n.ts._smartTimeline.algorithmSettings }}</template>
							<div class="_gaps_s">
								<MkSelect v-model="preferences.algorithm" :items="algorithmOptions" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.algorithm }}</template>
								</MkSelect>

								<MkSelect v-model="preferences.diversityLevel" :items="diversityOptions" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.diversityLevel }}</template>
								</MkSelect>

								<MkRange v-model="preferences.freshnessWeight" :min="0" :max="1" :step="0.1" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.freshnessWeight }}</template>
									<template #caption>{{ i18n.ts._smartTimeline.freshnessWeightDesc }}</template>
								</MkRange>

								<MkRange v-model="preferences.qualityThreshold" :min="0" :max="1" :step="0.1" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.qualityThreshold }}</template>
									<template #caption>{{ i18n.ts._smartTimeline.qualityThresholdDesc }}</template>
								</MkRange>
							</div>
						</MkFolder>

						<MkFolder>
							<template #label>{{ i18n.ts._smartTimeline.displaySettings }}</template>
							<div class="_gaps_s">
								<MkSwitch v-model="preferences.showScoreIndicator" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.showScoreIndicator }}</template>
									<template #caption>{{ i18n.ts._smartTimeline.showScoreIndicatorDesc }}</template>
								</MkSwitch>

								<MkSwitch v-model="preferences.adaptiveMode" @update:modelValue="savePreferences">
									<template #label>{{ i18n.ts._smartTimeline.adaptiveMode }}</template>
									<template #caption>{{ i18n.ts._smartTimeline.adaptiveModeDesc }}</template>
								</MkSwitch>
							</div>
						</MkFolder>

						<MkFolder v-if="analytics">
							<template #label>{{ i18n.ts.analytics }}</template>
							<div class="_gaps_s">
								<div :class="$style.analyticsGrid">
									<div :class="$style.analyticsCard">
										<div :class="$style.analyticsLabel">{{ i18n.ts._smartTimeline.currentMode }}</div>
										<div :class="$style.analyticsValue">
											<i :class="getModeIcon(analytics.currentMode.type)"></i>
											{{ getModeText(analytics.currentMode.type) }}
										</div>
									</div>
									<div :class="$style.analyticsCard">
										<div :class="$style.analyticsLabel">{{ i18n.ts._smartTimeline.cacheHitRate }}</div>
										<div :class="$style.analyticsValue">{{ Math.round(analytics.performanceMetrics.cacheHitRate * 100) }}%</div>
									</div>
									<div :class="$style.analyticsCard">
										<div :class="$style.analyticsLabel">{{ i18n.ts._smartTimeline.loadTime }}</div>
										<div :class="$style.analyticsValue">{{ analytics.performanceMetrics.averageLoadTime }}ms</div>
									</div>
									<div :class="$style.analyticsCard">
										<div :class="$style.analyticsLabel">{{ i18n.ts._smartTimeline.diversity }}</div>
										<div :class="$style.analyticsValue">{{ Math.round(analytics.performanceMetrics.contentDiversity * 100) }}%</div>
									</div>
								</div>
							</div>
						</MkFolder>

						<div :class="$style.actions">
							<MkButton primary @click="refreshTimeline">
								<i class="ti ti-refresh"></i>
								{{ i18n.ts.refresh }}
							</MkButton>
							<MkButton @click="resetPreferences">
								<i class="ti ti-restore"></i>
								{{ i18n.ts.resetToDefaultValue }}
							</MkButton>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from 'vue';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkSmartTimeline from '@/components/MkSmartTimeline.vue';
import MkRecommendedTimeline from '@/components/MkRecommendedTimeline.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import MkTip from '@/components/global/MkTip.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkSelect from '@/components/MkSelect.vue';
import type { MkSelectItem } from '@/components/MkSelect.vue';
import MkRange from '@/components/MkRange.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const ALGORITHMS = ['smart', 'hybrid', 'social', 'discovery'] as const;
type Algorithm = typeof ALGORITHMS[number];
const DIVERSITY_LEVELS = ['low', 'medium', 'high'] as const;
type DiversityLevel = typeof DIVERSITY_LEVELS[number];

interface SmartTimelinePreferences {
	algorithm: Algorithm;
	diversityLevel: DiversityLevel;
	freshnessWeight: number;
	qualityThreshold: number;
	showScoreIndicator: boolean;
	adaptiveMode: boolean;
}

type TimelinePreferencesResponse = Partial<SmartTimelinePreferences> & {
	analytics?: {
		currentMode: { type: string };
		performanceMetrics: {
			cacheHitRate: number;
			contentDiversity: number;
			averageLoadTime: number;
		};
	};
};

function isAlgorithm(value: unknown): value is Algorithm {
	return typeof value === 'string' && (ALGORITHMS as readonly string[]).includes(value);
}

function isDiversityLevel(value: unknown): value is DiversityLevel {
	return typeof value === 'string' && (DIVERSITY_LEVELS as readonly string[]).includes(value);
}

const smartTimelineRef = ref();
const recommendedTimelineRef = ref();
const currentTab = ref<'smart' | 'recommended' | 'settings'>('smart');
const analytics = ref<{
	currentMode: { type: string };
	performanceMetrics: {
		cacheHitRate: number;
		contentDiversity: number;
		averageLoadTime: number;
	};
} | null>(null);

const preferences = ref<SmartTimelinePreferences>({
	algorithm: 'smart',
	diversityLevel: 'medium',
	freshnessWeight: 0.3,
	qualityThreshold: 0.4,
	showScoreIndicator: false,
	adaptiveMode: true,
});

const algorithmOptions = computed<MkSelectItem<Algorithm>[]>(() => [
	{ label: i18n.ts._smartTimeline.smart, value: 'smart' },
	{ label: i18n.ts._smartTimeline.hybrid, value: 'hybrid' },
	{ label: i18n.ts._smartTimeline.social, value: 'social' },
	{ label: i18n.ts._smartTimeline.discovery, value: 'discovery' },
]);

const diversityOptions = computed<MkSelectItem<DiversityLevel>[]>(() => [
	{ label: i18n.ts.low, value: 'low' },
	{ label: i18n.ts.medium, value: 'medium' },
	{ label: i18n.ts.high, value: 'high' },
]);

const headerTabs = computed(() => [
	{
		key: 'smart',
		title: i18n.ts.smartTimeline,
		icon: 'ti ti-sparkles',
	},
	{
		key: 'recommended',
		title: i18n.ts.recommended,
		icon: 'ti ti-thumb-up',
	},
	{
		key: 'settings',
		title: i18n.ts.settings,
		icon: 'ti ti-settings',
	},
] as Tab[]);

const headerActions = computed(() => {
	const actions: PageHeaderItem[] = [];

	if (currentTab.value === 'smart' || currentTab.value === 'recommended') {
		actions.push({
			icon: 'ti ti-refresh',
			text: i18n.ts.refresh,
			handler: refreshTimeline,
		});
	}

	actions.push({
		icon: 'ti ti-chart-line',
		text: i18n.ts.analytics,
		handler: () => currentTab.value = 'settings',
	});

	return actions;
});

async function loadPreferences() {
	if (!$i) return;

	try {
		const loadPromise = misskeyApi<TimelinePreferencesResponse>('i/timeline-preferences', {});
		const timeoutPromise = new Promise((_, reject) =>
			window.setTimeout(() => reject(new Error('Request timeout')), 8000)
		);

		const result = await Promise.race([loadPromise, timeoutPromise]) as TimelinePreferencesResponse;
		preferences.value = {
			algorithm: isAlgorithm(result.algorithm) ? result.algorithm : 'smart',
			diversityLevel: isDiversityLevel(result.diversityLevel) ? result.diversityLevel : 'medium',
			freshnessWeight: result.freshnessWeight ?? 0.3,
			qualityThreshold: result.qualityThreshold ?? 0.4,
			showScoreIndicator: result.showScoreIndicator ?? false,
			adaptiveMode: result.adaptiveMode ?? true,
		};
		analytics.value = result.analytics ?? null;
	} catch (err) {
		console.error('Failed to load preferences:', err);
		preferences.value = {
			algorithm: 'smart',
			diversityLevel: 'medium',
			freshnessWeight: 0.3,
			qualityThreshold: 0.4,
			showScoreIndicator: false,
			adaptiveMode: true,
		};
	}
}

async function savePreferences() {
	if (!$i) return;

	try {
		const savePromise = misskeyApi('i/update-timeline-preferences', preferences.value);
		const timeoutPromise = new Promise((_, reject) =>
			window.setTimeout(() => reject(new Error('Request timeout')), 8000)
		);

		await Promise.race([savePromise, timeoutPromise]);
		os.toast(i18n.ts._smartTimeline.settingsSavedSucc);
	} catch (err) {
		if ((err as Error)?.message?.includes('timeout') || (err as Error)?.message?.includes('port closed')) {
			os.toast(i18n.ts._smartTimeline.saveTimeOut);
		} else {
			await os.alert({
				type: 'error',
				text: i18n.ts._smartTimeline.settingsSaveFailed,
			});
		}
	}
}

async function refreshTimeline() {
	try {
		if (currentTab.value === 'smart' && smartTimelineRef.value) {
			await smartTimelineRef.value.reloadTimeline();
		} else if (currentTab.value === 'recommended' && recommendedTimelineRef.value) {
			await recommendedTimelineRef.value.reloadTimeline();
		}

		// Refresh cache with timeout
		const refreshPromise = misskeyApi('notes/timeline-refresh', {});
		const timeoutPromise = new Promise((_, reject) =>
			window.setTimeout(() => reject(new Error('Request timeout')), 10000)
		);

		await Promise.race([refreshPromise, timeoutPromise]);
		os.toast(i18n.ts._smartTimeline.cacheRefreshed);
	} catch (err) {
		if (!(err as Error)?.message?.includes('timeout') && !(err as Error)?.message?.includes('port closed')) {
			os.toast(i18n.ts._smartTimeline.refreshedLocally);
		}
	}
}

async function resetPreferences() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.resetAreYouSure,
	});

	if (canceled) return;

	preferences.value = {
		algorithm: 'smart',
		diversityLevel: 'medium',
		freshnessWeight: 0.3,
		qualityThreshold: 0.4,
		showScoreIndicator: false,
		adaptiveMode: true,
	};

	await savePreferences();
	await refreshTimeline();
}

function getModeIcon(type: string): string {
	switch (type) {
		case 'smart': return 'ti ti-brain';
		case 'mixed': return 'ti ti-adjustments';
		case 'chronological': return 'ti ti-clock';
		default: return 'ti ti-sparkles';
	}
}

function getModeText(type: string): string {
	switch (type) {
		case 'smart': return i18n.ts._smartTimeline.smartMode;
		case 'mixed': return i18n.ts._smartTimeline.mixedMode;
		case 'chronological': return i18n.ts._smartTimeline.chronologicalMode;
		default: return i18n.ts._smartTimeline.autoMode;
	}
}

async function onNote(note: any) {
	if (!$i) return;

	try {
		await misskeyApi('notes/interaction', {
			targetId: note.id,
			targetType: 'note',
			interactionType: 'view',
			source: 'smart-timeline-page',
		});
	} catch (err) {
		console.debug('Failed to record note interaction:', err);
	}
}

onMounted(() => {
	loadPreferences();
});

watch(() => currentTab.value, () => {
	if (currentTab.value === 'settings') {
		loadPreferences();
	}
});

definePage(() => ({
	title: i18n.ts.smartTimeline,
	icon: 'ti ti-sparkles',
}));
</script>

<style lang="scss" module>
.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 16px;
}

.title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: bold;

	i {
		color: var(--MI_THEME-accent);
	}
}

.analytics {
	display: flex;
	gap: 16px;
}

.metric {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}

.metricLabel {
	font-size: 0.8em;
	color: var(--MI_THEME-fgTransparentWeak);
}

.metricValue {
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.postForm {
	border-radius: var(--MI-radius);
}

.settingsContainer {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.analyticsGrid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 16px;
}

.analyticsCard {
	padding: 16px;
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	border: 1px solid var(--MI_THEME-divider);
}

.analyticsLabel {
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
	margin-bottom: 4px;
}

.analyticsValue {
	font-weight: bold;
	color: var(--MI_THEME-fg);
	display: flex;
	align-items: center;
	gap: 4px;

	i {
		color: var(--MI_THEME-accent);
	}
}

.actions {
	display: flex;
	gap: 12px;
	justify-content: center;
}
</style>
