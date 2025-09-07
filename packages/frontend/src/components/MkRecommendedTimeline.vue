<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="() => reloadTimeline()">
		<MkLoading v-if="loading"/>

		<MkError v-else-if="error" @retry="init()"/>

		<div v-else-if="notes.length === 0" key="_empty_">
			<MkResult type="empty" :text="i18n.ts.noNotes"/>
		</div>

		<div v-else ref="rootEl">
			<div v-if="localShowAlgorithmInfo" :class="$style.algorithmInfo">
				<div :class="$style.algorithmHeader">
					<div :class="$style.algorithmDetails">
						<span :class="$style.algorithmLabel">{{ i18n.ts._smartTimeline.algorithm }} </span>
						<span :class="$style.algorithmValue">{{ algorithm }}</span>
					</div>
					<button class="_button" :class="$style.settingsButton" :title=i18n.ts._smartTimeline.smartTimelineSettings @click="openSettings">
						<i class="ti ti-settings"></i>
					</button>
				</div>
				<div :class="$style.factorWeights">
					<div v-for="(weight, factor) in factors" :key="factor" :class="$style.factor">
						<span :class="$style.factorName">{{ getFactorName(factor) }}</span>
						<div :class="$style.factorBar">
							<div :class="$style.factorFill" :style="{ width: `${weight * 100}%` }"></div>
						</div>
						<span :class="$style.factorValue">{{ Math.round(weight * 100) }}%</span>
					</div>
				</div>
			</div>

			<div v-else :class="$style.compactSettingsContainer">
				<button class="_button" :class="$style.compactSettingsButton" :title=i18n.ts._smartTimeline.smartTimelineSettings @click="openSettings">
					<i class="ti ti-settings"></i>
					{{ i18n.ts.settings }}
				</button>
			</div>

			<div v-if="queuedNotes.length > 0" :class="$style.new">
				<div :class="$style.newBg1"></div>
				<div :class="$style.newBg2"></div>
				<button class="_button" :class="$style.newButton" @click="releaseQueue()">
					<i class="ti ti-thumb-up"></i> {{ i18n.ts._smartTimeline.newRecommendationsAvailable }}
				</button>
			</div>

			<component
				:is="prefer.s.animation ? TransitionGroup : 'div'"
				:class="$style.notes"
				:enterActiveClass="$style.transition_x_enterActive"
				:leaveActiveClass="$style.transition_x_leaveActive"
				:enterFromClass="$style.transition_x_enterFrom"
				:leaveToClass="$style.transition_x_leaveTo"
				:moveClass="$style.transition_x_move"
				tag="div"
			>
				<template v-for="note in notes" :key="note.id">
					<div v-if="localShowScores && scores[note.id]" :class="$style.scoreIndicator">
						<div :class="$style.scoreInfo">
							<span :class="$style.scoreLabel">{{ i18n.ts._smartTimeline.relevanceScore }}</span>
							<span :class="$style.scoreValue">{{ Math.round(scores[note.id] * 100) }}</span>
						</div>
						<div :class="$style.scoreBar">
							<div :class="$style.scoreFill" :style="{ width: `${scores[note.id] * 100}%` }"></div>
						</div>
					</div>
					<MkNote
						:class="$style.note"
						:note="note"
						:withHardMute="true"
						:data-scroll-anchor="note.id"
						@click="onNoteClick(note)"
					/>
				</template>
			</component>

			<button
				v-show="hasMore"
				key="_more_"
				v-appear="prefer.s.enableInfiniteScroll ? fetchMore : null"
				:disabled="fetchingMore"
				class="_button"
				:class="$style.more"
				@click="fetchMore"
			>
				<template v-if="fetchingMore">
					<MkLoading mini/>
				</template>
				<template v-else>
					{{ i18n.ts.loadMore }}
				</template>
			</button>
		</div>
	</component>
</div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { TransitionGroup } from 'vue';
import type * as Misskey from 'misskey-js';
import MkNote from '@/components/MkNote.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkError from '@/components/global/MkError.vue';
import MkResult from '@/components/global/MkResult.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';

interface RecommendedTimelineOptions {
	context?: 'timeline' | 'explore' | 'related' | 'trending';
	includeFollowing?: boolean;
	diversityFactor?: number;
	recencyWeight?: number;
	qualityThreshold?: number;
	showScores?: boolean;
	showAlgorithmInfo?: boolean;
}

const props = withDefaults(defineProps<RecommendedTimelineOptions>(), {
	context: 'timeline',
	includeFollowing: false,
	diversityFactor: 0.7,
	recencyWeight: 0.7,
	qualityThreshold: 0.5,
	showScores: false,
	showAlgorithmInfo: false,
});

const emit = defineEmits<{
	note: [note: Misskey.entities.Note];
}>();

const rootEl = ref<HTMLElement>();
const notes = ref<Misskey.entities.Note[]>([]);
const queuedNotes = ref<Misskey.entities.Note[]>([]);
const scores = ref<Record<string, number>>({});
const factors = ref<Record<string, number>>({});
const algorithm = ref<string>('');
const loading = ref(true);
const error = ref(false);
const fetchingMore = ref(false);
const hasMore = ref(true);
const offset = ref(0);

const localContext = ref(props.context);
const localIncludeFollowing = ref(props.includeFollowing);
const localDiversityFactor = ref(props.diversityFactor);
const localRecencyWeight = ref(props.recencyWeight);
const localQualityThreshold = ref(props.qualityThreshold);
const localShowScores = ref(props.showScores);
const localShowAlgorithmInfo = ref(props.showAlgorithmInfo);

async function init() {
	loading.value = true;
	error.value = false;
	offset.value = 0;

	try {
		const result = await misskeyApi('notes/recommended', {
			limit: 20,
			context: localContext.value,
			includeFollowing: localIncludeFollowing.value,
			diversityFactor: localDiversityFactor.value,
			recencyWeight: localRecencyWeight.value,
			qualityThreshold: localQualityThreshold.value,
		});

		notes.value = result.notes;
		scores.value = result.scores || {};
		factors.value = result.factors || {};
		algorithm.value = result.algorithm || 'hybrid_collaborative_content';
		hasMore.value = result.hasMore;
		offset.value = result.notes.length;

		for (const note of result.notes) {
			await recordInteraction(note.id, 'view');
		}
	} catch (err) {
		console.error('Failed to load recommended timeline:', err);
		error.value = true;
	} finally {
		loading.value = false;
	}
}

async function fetchMore() {
	if (fetchingMore.value || !hasMore.value) return;

	fetchingMore.value = true;

	try {
		const result = await misskeyApi('notes/recommended', {
			limit: 20,
			offset: offset.value,
			context: localContext.value,
			includeFollowing: localIncludeFollowing.value,
			diversityFactor: localDiversityFactor.value,
			recencyWeight: localRecencyWeight.value,
			qualityThreshold: localQualityThreshold.value,
		});

		notes.value.push(...result.notes);
		Object.assign(scores.value, result.scores || {});
		hasMore.value = result.hasMore;
		offset.value += result.notes.length;

		for (const note of result.notes) {
			await recordInteraction(note.id, 'view');
		}
	} catch (err) {
		console.error('Failed to load more notes:', err);
	} finally {
		fetchingMore.value = false;
	}
}

async function reloadTimeline() {
	await init();
}

function releaseQueue() {
	notes.value.unshift(...queuedNotes.value);
	queuedNotes.value = [];
}

async function recordInteraction(noteId: string, type: string, context?: any) {
	if (!$i) return;

	try {
		await misskeyApi('notes/interaction', {
			targetId: noteId,
			targetType: 'note',
			interactionType: type,
			source: 'recommended_timeline',
			...context,
		});
	} catch (err) {
		console.warn('Failed to record interaction:', err);
	}
}

function onNoteClick(note: Misskey.entities.Note) {
	recordInteraction(note.id, 'click', {
		position: notes.value.indexOf(note),
		score: scores.value[note.id],
	});
	emit('note', note);
}

function getFactorName(factor: string): string {
	const factorNames: Record<string, string> = {
		contentRelevance: i18n.ts._smartTimeline.contentRelevance,
		socialFactors: i18n.ts._smartTimeline.socialFactors,
		recency: i18n.ts._smartTimeline.recency,
		quality: i18n.ts._smartTimeline.quality,
		diversity: i18n.ts._smartTimeline.diversity,
		exploration: i18n.ts._smartTimeline.exploration,
	};
	return factorNames[factor] || factor;
}

let refreshInterval: number | null = null;

onMounted(() => {
	init();

	refreshInterval = window.setInterval(() => {
		if (window.document.visibilityState === 'visible') {
			reloadTimeline();
		}
	}, 10 * 60 * 1000);
});

onUnmounted(() => {
	if (refreshInterval) {
		window.clearInterval(refreshInterval);
	}
});

watch([
	() => props.context,
	() => props.includeFollowing,
	() => props.diversityFactor,
	() => props.recencyWeight,
	() => props.qualityThreshold,
], () => {
	init();
});

watch([
	localContext,
	localIncludeFollowing,
	localDiversityFactor,
	localRecencyWeight,
	localQualityThreshold,
], () => {
	init();
});

function openSettings(ev: MouseEvent) {
	os.popupMenu([
		{
			type: 'parent' as const,
			text: i18n.ts._smartTimeline.context,
			icon: 'ti ti-category',
			children: [
				{ text: i18n.ts._smartTimeline.timeline, active: localContext.value === 'timeline', action: () => { localContext.value = 'timeline'; } },
				{ text: i18n.ts.explore, active: localContext.value === 'explore', action: () => { localContext.value = 'explore'; } },
				{ text: i18n.ts._smartTimeline.related, active: localContext.value === 'related', action: () => { localContext.value = 'related'; } },
				{ text: i18n.ts._smartTimeline.trending, active: localContext.value === 'trending', action: () => { localContext.value = 'trending'; } },
			],
		},
		{
			type: 'switch' as const,
			text: i18n.ts._smartTimeline.includeFollowing,
			icon: 'ti ti-users',
			ref: localIncludeFollowing,
		},
		{
			type: 'switch' as const,
			text: i18n.ts._smartTimeline.showAlgorithmInfo,
			icon: 'ti ti-chart-line',
			ref: localShowAlgorithmInfo,
		},
		{
			type: 'switch' as const,
			text: i18n.ts._smartTimeline.showScores,
			icon: 'ti ti-chart-bar',
			ref: localShowScores,
		},
		{ type: 'divider' },
		{
			type: 'parent' as const,
			text: i18n.ts._smartTimeline.algorithmParameters,
			icon: 'ti ti-adjustments',
			children: [
				{
					text: `${i18n.ts._smartTimeline.diversity}: ${Math.round(localDiversityFactor.value * 100)}%`,
					action: async () => {
						const { result: value } = await os.inputNumber({
							title: i18n.ts._smartTimeline.diversityFactor,
							text: i18n.ts._smartTimeline.controlsContentVariety,
							default: Math.round(localDiversityFactor.value * 100),
						});
						if (value != null) localDiversityFactor.value = Math.max(0, Math.min(1, value / 100));
					},
				},
				{
					text: `${i18n.ts._smartTimeline.recencyWeight}: ${Math.round(localRecencyWeight.value * 100)}%`,
					action: async () => {
						const { result: value } = await os.inputNumber({
							title: i18n.ts._smartTimeline.recencyWeight,
							text: i18n.ts._smartTimeline.preferenceForNewerContent,
							default: Math.round(localRecencyWeight.value * 100),
						});
						if (value != null) localRecencyWeight.value = Math.max(0, Math.min(1, value / 100));
					},
				},
				{
					text: `${i18n.ts._smartTimeline.qualityThreshold}: ${Math.round(localQualityThreshold.value * 100)}%`,
					action: async () => {
						const { result: value } = await os.inputNumber({
							title: i18n.ts._smartTimeline.qualityThreshold,
							text: i18n.ts._smartTimeline.minimumContentQuality,
							default: Math.round(localQualityThreshold.value * 100),
						});
						if (value != null) localQualityThreshold.value = Math.max(0, Math.min(1, value / 100));
					},
				},
			],
		},
		{ type: 'divider' },
		{
			text: i18n.ts.reset,
			icon: 'ti ti-refresh',
			action: () => {
				localContext.value = props.context;
				localIncludeFollowing.value = props.includeFollowing;
				localDiversityFactor.value = props.diversityFactor;
				localRecencyWeight.value = props.recencyWeight;
				localQualityThreshold.value = props.qualityThreshold;
				localShowScores.value = props.showScores;
				localShowAlgorithmInfo.value = props.showAlgorithmInfo;
			},
		},
	], ev.currentTarget ?? ev.target);
}

defineExpose({
	reloadTimeline,
});
</script>

<style lang="scss" module>
.new {
	position: sticky;
	top: calc(var(--MI-stickyTop, 0px) + 16px);
	z-index: 1000;
	width: 100%;
	margin: calc(-0.675em - 8px) 0;

	&:first-child {
		margin-top: calc(-0.675em - 8px - var(--MI-margin));
	}
}

.newBg1, .newBg2 {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	border-radius: 32px;
}

.newBg1 {
	background: var(--MI_THEME-accent);
	opacity: 0.1;
}

.newBg2 {
	background: linear-gradient(90deg, var(--MI_THEME-accent), var(--MI_THEME-accentLighten));
	opacity: 0.05;
}

.newButton {
	position: relative;
	display: block;
	margin: var(--MI-margin) auto 0 auto;
	padding: 8px 16px;
	border-radius: 32px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-accent);
	font-weight: bold;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}
}

.algorithmInfo {
	padding: 16px;
	margin-bottom: 16px;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	border: 1px solid var(--MI_THEME-divider);
}

.algorithmDetails {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
	font-size: 0.9em;
}

.algorithmLabel {
	color: var(--MI_THEME-fgTransparentWeak);
}

.algorithmValue {
	color: var(--MI_THEME-accent);
	font-weight: bold;
}

.factorWeights {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 8px;
}

.factor {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.8em;
}

.factorName {
	min-width: 80px;
	color: var(--MI_THEME-fgTransparentWeak);
}

.factorBar {
	flex: 1;
	height: 4px;
	background: var(--MI_THEME-divider);
	border-radius: 2px;
	overflow: hidden;
}

.factorFill {
	height: 100%;
	background: var(--MI_THEME-accent);
	transition: width 0.3s ease;
}

.factorValue {
	min-width: 30px;
	text-align: right;
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.scoreIndicator {
	padding: 8px 16px;
	background: var(--MI_THEME-bg);
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.scoreInfo {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 4px;
	font-size: 0.8em;
}

.scoreLabel {
	color: var(--MI_THEME-fgTransparentWeak);
}

.scoreValue {
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.scoreBar {
	height: 4px;
	background: var(--MI_THEME-divider);
	border-radius: 2px;
	overflow: hidden;
}

.scoreFill {
	height: 100%;
	background: linear-gradient(90deg, var(--MI_THEME-warn), var(--MI_THEME-accent), var(--MI_THEME-success));
	transition: width 0.3s ease;
}

.notes {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.note {
	border-bottom: 1px solid var(--MI_THEME-divider);
	cursor: pointer;
	transition: background-color 0.2s ease;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:last-child {
		border-bottom: none;
	}
}

.more {
	display: block;
	width: 100%;
	padding: 16px;
	color: var(--MI_THEME-fgTransparentWeak);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		opacity: 0.7;
	}
}

.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.3s, transform 0.3s;
}

.transition_x_enterFrom {
	opacity: 0;
	transform: translateY(-16px);
}

.transition_x_leaveTo {
	opacity: 0;
	transform: translateY(-16px);
}

.transition_x_move {
	transition: transform 0.3s;
}

.algorithmHeader {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.compactSettingsContainer {
	display: flex;
	justify-content: flex-end;
	margin-bottom: 16px;
}

.compactSettingsButton {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 16px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	border: 1px solid var(--MI_THEME-divider);
	font-size: 0.9em;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
		color: var(--MI_THEME-accent);
	}
}

// Settings styles
.settingsButtonContainer {
	position: sticky;
	top: calc(var(--MI-stickyTop, 0px) + 8px);
	z-index: 1001;
	width: 100%;
	display: flex;
	justify-content: flex-end;
	margin-bottom: 8px;
}

.settingsButton {
	padding: 8px;
	border-radius: 50%;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	border: 1px solid var(--MI_THEME-divider);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

	&:hover {
		background: var(--MI_THEME-panelHighlight);
		color: var(--MI_THEME-accent);
	}
}

.settingsPanel {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	background: rgba(0, 0, 0, 0.5);
	z-index: 2000;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	box-sizing: border-box;
}

.settingsHeader {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 16px;
	border-bottom: 1px solid var(--MI_THEME-divider);

	h3 {
		margin: 0;
		color: var(--MI_THEME-fg);
	}
}

.closeButton {
	padding: 8px;
	border-radius: 50%;
	color: var(--MI_THEME-fgTransparentWeak);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		color: var(--MI_THEME-fg);
	}
}

.settingsContent {
	padding: 16px;
	max-height: 400px;
	overflow-y: auto;
	width: 100%;
	max-width: 500px;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.settingGroup {
	margin-bottom: 16px;

	&:last-child {
		margin-bottom: 0;
	}
}

.settingLabel {
	display: block;
	margin-bottom: 8px;
	font-weight: bold;
	color: var(--MI_THEME-fg);
	font-size: 0.9em;
}

.settingSelect {
	width: 100%;
	padding: 8px 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
}

.settingRange {
	width: 100%;
	height: 6px;
	-webkit-appearance: none;
	appearance: none;
	background: var(--MI_THEME-divider);
	border-radius: 3px;
	outline: none;

	&::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		cursor: pointer;
	}

	&::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		cursor: pointer;
		border: none;
	}
}

.settingCheckbox {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
	color: var(--MI_THEME-fg);

	input[type="checkbox"] {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}
}
</style>
