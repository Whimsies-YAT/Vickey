<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.container">
	<div :class="$style.header">
		<h2 :class="$style.title">
			<i class="ti ti-adjustments"></i>
			{{ i18n.ts._smartTimeline.timelinePref }}
		</h2>
		<button v-if="!embedded" class="_button" :class="$style.closeButton" @click="$emit('close')">
			<i class="ti ti-x"></i>
		</button>
	</div>

	<div :class="$style.content">
		<div class="_gaps_m">
			<div :class="$style.section">
				<h3 :class="$style.sectionTitle">{{ i18n.ts._smartTimeline.timelineMode }}</h3>
				<div :class="$style.modeGrid">
					<button
						v-for="mode in timelineModes"
						:key="mode.value"
						class="_button"
						:class="[$style.modeCard, { [$style.modeCardActive]: preferences.mode === mode.value }]"
						@click="updatePreference('mode', mode.value as TimelinePreferences['mode'])"
					>
						<div :class="$style.modeIcon">
							<i :class="mode.icon"></i>
						</div>
						<div :class="$style.modeInfo">
							<div :class="$style.modeName">{{ mode.label }}</div>
							<div :class="$style.modeDescription">{{ mode.description }}</div>
						</div>
					</button>
				</div>
			</div>

			<div v-if="preferences.mode === 'mixed'" :class="$style.section">
				<h3 :class="$style.sectionTitle">Smart Content Ratio</h3>
				<div :class="$style.sliderContainer">
					<div :class="$style.sliderLabels">
						<span>Chronological</span>
						<span>Smart</span>
					</div>
					<input
						v-model.number="preferences.smartRatio"
						type="range"
						min="0"
						max="1"
						step="0.1"
						:class="$style.slider"
						@input="updatePreference('smartRatio', Number(($event.target as HTMLInputElement).value))"
					>
					<div :class="$style.sliderValue">
						{{ i18n.tsx._smartTimeline.smartRatio({ smartRatio: Math.round(preferences.smartRatio * 100) }) }}
					</div>
				</div>
			</div>

			<div :class="$style.section">
				<h3 :class="$style.sectionTitle">Algorithm Settings</h3>
				<div class="_gaps_s">
					<div :class="$style.setting">
						<label :class="$style.settingLabel">{{ i18n.ts._smartTimeline.algorithm }}</label>
						<select
							v-model="preferences.algorithm"
							:class="$style.select"
							@change="updatePreference('algorithm', ($event.target as HTMLSelectElement).value as TimelinePreferences['algorithm'])"
						>
							<option value="smart">{{ i18n.ts._smartTimeline.smart }}</option>
							<option value="hybrid">{{ i18n.ts._smartTimeline.hybrid }}</option>
							<option value="social">{{ i18n.ts._smartTimeline.social }}</option>
							<option value="discovery">{{ i18n.ts._smartTimeline.discovery }}</option>
						</select>
					</div>

					<div :class="$style.setting">
						<label :class="$style.settingLabel">{{ i18n.ts._smartTimeline.diversityLevel }}</label>
						<select
							v-model="preferences.diversityLevel"
							:class="$style.select"
							@change="updatePreference('diversityLevel', ($event.target as HTMLSelectElement).value as TimelinePreferences['diversityLevel'])"
						>
							<option value="low">{{ i18n.ts.low }}</option>
							<option value="medium">{{ i18n.ts.medium }}</option>
							<option value="high">{{ i18n.ts.high }}</option>
						</select>
					</div>

					<div :class="$style.setting">
						<label :class="$style.settingLabel">
							{{ i18n.ts._smartTimeline.freshnessWeight }}
							<span :class="$style.settingValue">{{ Math.round(preferences.freshnessWeight * 100) }}%</span>
						</label>
						<input
							v-model.number="preferences.freshnessWeight"
							type="range"
							min="0"
							max="1"
							step="0.1"
							:class="$style.slider"
							@input="updatePreference('freshnessWeight', Number(($event.target as HTMLInputElement).value))"
						>
					</div>

					<div :class="$style.setting">
						<label :class="$style.settingLabel">
							{{ i18n.ts._smartTimeline.qualityThreshold }}
							<span :class="$style.settingValue">{{ Math.round(preferences.qualityThreshold * 100) }}%</span>
						</label>
						<input
							v-model.number="preferences.qualityThreshold"
							type="range"
							min="0"
							max="1"
							step="0.1"
							:class="$style.slider"
							@input="updatePreference('qualityThreshold', Number(($event.target as HTMLInputElement).value))"
						>
					</div>
				</div>
			</div>

			<div :class="$style.section">
				<h3 :class="$style.sectionTitle">{{ i18n.ts._smartTimeline.displaySettings }}</h3>
				<div class="_gaps_s">
					<label :class="$style.checkboxLabel">
						<input
							v-model="preferences.showScoreIndicator"
							type="checkbox"
							:class="$style.checkbox"
							@change="updatePreference('showScoreIndicator', ($event.target as HTMLInputElement).checked)"
						>
						<span>{{ i18n.ts._smartTimeline.showRelevanceScores }}</span>
					</label>

					<label :class="$style.checkboxLabel">
						<input
							v-model="preferences.adaptiveMode"
							type="checkbox"
							:class="$style.checkbox"
							@change="updatePreference('adaptiveMode', ($event.target as HTMLInputElement).checked)"
						>
						<span>{{ i18n.ts._smartTimeline.adaptiveMode }}</span>
					</label>
				</div>
			</div>

			<div v-if="analytics" :class="$style.section">
				<h3 :class="$style.sectionTitle">{{ i18n.ts._smartTimeline.currentStatus }}</h3>
				<div :class="$style.statusGrid">
					<div :class="$style.statusCard">
						<div :class="$style.statusLabel">{{ i18n.ts._smartTimeline.currentMode }}</div>
						<div :class="$style.statusValue">
							<i :class="getModeIcon(analytics.currentMode.type)"></i>
							{{ getModeText(analytics.currentMode.type) }}
						</div>
					</div>
					<div :class="$style.statusCard">
						<div :class="$style.statusLabel">{{ i18n.ts._smartTimeline.cacheHitRate }}</div>
						<div :class="$style.statusValue">{{ Math.round(analytics.performanceMetrics.cacheHitRate * 100) }}%</div>
					</div>
					<div :class="$style.statusCard">
						<div :class="$style.statusLabel">{{ i18n.ts._smartTimeline.diversity }}</div>
						<div :class="$style.statusValue">{{ Math.round(analytics.performanceMetrics.contentDiversity * 100) }}%</div>
					</div>
				</div>
			</div>

			<div :class="$style.actions">
				<button class="_button" :class="$style.actionButton" @click="resetToDefaults">
					<i class="ti ti-restore"></i>
					{{ i18n.ts.resetToDefaultValue }}
				</button>
				<button class="_button" :class="[$style.actionButton, $style.primaryButton]" @click="saveAndApply">
					<i class="ti ti-check"></i>
					{{ i18n.ts.save }}
				</button>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from 'vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

interface TimelinePreferences {
	mode: 'auto' | 'chronological' | 'smart' | 'mixed';
	smartRatio: number;
	algorithm: 'smart' | 'hybrid' | 'social' | 'discovery';
	diversityLevel: 'low' | 'medium' | 'high';
	freshnessWeight: number;
	qualityThreshold: number;
	showScoreIndicator: boolean;
	adaptiveMode: boolean;
}

const props = withDefaults(defineProps<{
	embedded?: boolean;
}>(), {
	embedded: false,
});

const emit = defineEmits<{
	close: [];
	updated: [preferences: TimelinePreferences];
}>();

const preferences = ref<TimelinePreferences>({
	mode: 'auto',
	smartRatio: 0.6,
	algorithm: 'smart',
	diversityLevel: 'medium',
	freshnessWeight: 0.3,
	qualityThreshold: 0.4,
	showScoreIndicator: false,
	adaptiveMode: true,
});

const analytics = ref<{
	currentMode: { type: string };
	performanceMetrics: { cacheHitRate: number; contentDiversity: number };
} | null>(null);

const timelineModes = computed(() => [
	{
		value: 'auto',
		label: i18n.ts._smartTimeline.autoMode,
		description: i18n.ts._smartTimeline.autoModeDesc,
		icon: 'ti ti-sparkles',
	},
	{
		value: 'smart',
		label: i18n.ts._smartTimeline.smartMode,
		description: i18n.ts._smartTimeline.smartModeDesc,
		icon: 'ti ti-brain',
	},
	{
		value: 'mixed',
		label: i18n.ts._smartTimeline.mixedMode,
		description: i18n.ts._smartTimeline.mixedModeDesc,
		icon: 'ti ti-adjustments',
	},
	{
		value: 'chronological',
		label: i18n.ts._smartTimeline.chronologicalMode,
		description: i18n.ts._smartTimeline.chronologicalModeDesc,
		icon: 'ti ti-clock',
	},
]);

async function loadPreferences() {
	if (!$i) return;

	try {
		const result = await os.apiWithDialog('i/timeline-preferences', {});
		preferences.value = {
			mode: result.mode || 'auto',
			smartRatio: result.smartRatio || 0.6,
			algorithm: result.algorithm || 'smart',
			diversityLevel: result.diversityLevel || 'medium',
			freshnessWeight: result.freshnessWeight || 0.3,
			qualityThreshold: result.qualityThreshold || 0.4,
			showScoreIndicator: result.showScoreIndicator || false,
			adaptiveMode: result.adaptiveMode ?? true,
		};
		analytics.value = result.analytics;
	} catch (err) {
		console.error('Failed to load preferences:', err);
	}
}

async function savePreferences() {
	if (!$i) return;

	try {
		await os.apiWithDialog('i/update-timeline-preferences', preferences.value);
		emit('updated', preferences.value);
		return true;
	} catch (err) {
		await os.alert({
			type: 'error',
			text: i18n.ts._smartTimeline.settingsSaveFailed,
		});
		return false;
	}
}

function updatePreference<K extends keyof TimelinePreferences>(key: K, value: TimelinePreferences[K]) {
	preferences.value[key] = value;
}

async function resetToDefaults() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.resetAreYouSure,
	});

	if (canceled) return;

	preferences.value = {
		mode: 'auto',
		smartRatio: 0.6,
		algorithm: 'smart',
		diversityLevel: 'medium',
		freshnessWeight: 0.3,
		qualityThreshold: 0.4,
		showScoreIndicator: false,
		adaptiveMode: true,
	};
}

async function saveAndApply() {
	const success = await savePreferences();
	if (success) {
		os.toast(i18n.ts._smartTimeline.settingsSavedSucc);
		if (!props.embedded) {
			emit('close');
		}
	}
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

onMounted(() => {
	loadPreferences();
});

let saveTimeout: number | null = null;
watch(preferences, () => {
	if (saveTimeout) {
		window.clearTimeout(saveTimeout);
	}
	saveTimeout = window.setTimeout(() => {
		savePreferences();
	}, 1000);
}, { deep: true });
</script>

<style lang="scss" module>
.container {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	overflow: hidden;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	background: var(--MI_THEME-bg);
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.title {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 1.1em;
	font-weight: bold;

	i {
		color: var(--MI_THEME-accent);
	}
}

.closeButton {
	padding: 4px;
	border-radius: 4px;
	color: var(--MI_THEME-fgTransparentWeak);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		color: var(--MI_THEME-fg);
	}
}

.content {
	padding: 20px;
	max-height: 70vh;
	overflow-y: auto;
}

.section {
	margin-bottom: 24px;
}

.sectionTitle {
	margin: 0 0 12px 0;
	font-size: 1em;
	font-weight: bold;
	color: var(--MI_THEME-fg);
}

.modeGrid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 12px;
}

.modeCard {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px;
	background: var(--MI_THEME-bg);
	border: 2px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	text-align: left;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-panelHighlight);
	}

	&.modeCardActive {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accentedBg);
	}
}

.modeIcon {
	font-size: 1.5em;
	color: var(--MI_THEME-accent);
}

.modeInfo {
	flex: 1;
}

.modeName {
	font-weight: bold;
	margin-bottom: 4px;
}

.modeDescription {
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
}

.sliderContainer {
	background: var(--MI_THEME-bg);
	padding: 16px;
	border-radius: var(--MI-radius);
}

.sliderLabels {
	display: flex;
	justify-content: space-between;
	margin-bottom: 8px;
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
}

.slider {
	width: 100%;
	margin-bottom: 8px;
}

.sliderValue {
	text-align: center;
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.setting {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.settingLabel {
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-weight: 500;
}

.settingValue {
	color: var(--MI_THEME-accent);
	font-weight: bold;
}

.select {
	padding: 8px 12px;
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	color: var(--MI_THEME-fg);
}

.checkboxLabel {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
}

.checkbox {
	accent-color: var(--MI_THEME-accent);
}

.statusGrid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 12px;
}

.statusCard {
	padding: 12px;
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	border: 1px solid var(--MI_THEME-divider);
}

.statusLabel {
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
	margin-bottom: 4px;
}

.statusValue {
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
	justify-content: flex-end;
	margin-top: 24px;
	padding-top: 16px;
	border-top: 1px solid var(--MI_THEME-divider);
}

.actionButton {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 16px;
	border-radius: var(--MI-radius);
	font-weight: 500;
	transition: all 0.2s ease;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.primaryButton {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);

		&:hover {
			background: var(--MI_THEME-accentDarken);
		}
	}
}
</style>
