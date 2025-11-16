<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<div v-if="showModeIndicator" :class="$style.modeIndicator">
		<div :class="$style.modeInfo">
			<i :class="getModeIcon(currentMode?.type)"></i>
			<span>{{ getModeText(currentMode?.type) }}</span>
			<span v-if="currentMode?.smartRatio" :class="$style.ratio">
				{{ i18n.tsx._smartTimeline.smartRatio({ smartRatio: Math.round(currentMode.smartRatio * 100) }) }}
			</span>
		</div>
		<button class="_button" :class="$style.settingsButton" @click="openSettings">
			<i class="ti ti-settings"></i>
		</button>
	</div>

	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="() => reloadTimeline()">
		<MkLoading v-if="loading"/>

		<MkError v-else-if="error" @retry="init()"/>

		<div v-else-if="notes.length === 0" key="_empty_">
			<MkResult type="empty" :text="i18n.ts.noNotes"/>
		</div>

		<div v-else ref="rootEl">
			<div v-if="queuedNotes.length > 0" :class="$style.new">
				<div :class="$style.newBg1"></div>
				<div :class="$style.newBg2"></div>
				<button class="_button" :class="$style.newButton" @click="releaseQueue()">
					<i class="ti ti-sparkles"></i> {{ i18n.ts._smartTimeline.newRecommendationsAvailable }}
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
					<div v-if="showScoreIndicator" :class="$style.scoreIndicator">
						<div :class="$style.scoreBar">
							<div
								:class="scores[note.id] ? $style.scoreFill : $style.scoreUnknown"
								:style="{ width: scores[note.id] ? `${scores[note.id] * 100}%` : '100%' }"
							></div>
						</div>
						<span v-if="scores[note.id]" :class="$style.scoreText">{{ Math.round(scores[note.id] * 100) }}</span>
					</div>
					<MkNote :class="$style.note" :note="note" :withHardMute="true" :data-scroll-anchor="note.id"/>
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
import { ref, computed, onMounted, onUnmounted, watch, TransitionGroup } from 'vue';
import MkNote from '@/components/MkNote.vue';
import type * as Misskey from 'misskey-js';
import MkLoading from '@/components/global/MkLoading.vue';
import MkError from '@/components/global/MkError.vue';
import MkResult from '@/components/global/MkResult.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { i18n } from "../../../frontend-embed/src/i18n";
import { useStream } from '@/stream.js';
import { store } from '@/store.js';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';

type SmartTimelineResponse =
	| Misskey.entities.Note[]
	| { notes: Misskey.entities.Note[]; scores: Record<string, number> };

function isSmartTimelineWithScores(response: SmartTimelineResponse): response is { notes: Misskey.entities.Note[]; scores: Record<string, number> } {
	return typeof response === 'object' && !Array.isArray(response) && 'notes' in response && Array.isArray(response.notes);
}

interface SmartTimelineOptions {
	algorithm?: 'smart' | 'hybrid' | 'social' | 'discovery';
	diversityLevel?: 'low' | 'medium' | 'high';
	freshnessWeight?: number;
	qualityThreshold?: number;
	showModeIndicator?: boolean;
	showScoreIndicator?: boolean;
	autoRefresh?: boolean;
}

interface TimelineMode {
	type: 'chronological' | 'smart' | 'mixed';
	smartRatio: number;
	reason: string;
}

const props = withDefaults(defineProps<SmartTimelineOptions>(), {
	algorithm: 'smart',
	diversityLevel: 'medium',
	freshnessWeight: 0.3,
	qualityThreshold: 0.4,
	showModeIndicator: true,
	showScoreIndicator: false,
	autoRefresh: true,
});

const rootEl = ref<HTMLElement>();
const notes = ref<Misskey.entities.Note[]>([]);
const queuedNotes = ref<Misskey.entities.Note[]>([]);
const scores = ref<Record<string, number>>({});
const currentMode = ref<TimelineMode | null>(null);
const loading = ref(true);
const error = ref(false);
const fetchingMore = ref(false);
const hasMore = ref(true);
const offset = ref(0);
const noteViewTimes = ref<Record<string, number>>({});
const noteObserver = ref<IntersectionObserver | null>(null);

const stream = store.s.realtimeMode ? useStream() : null;
let connection: Misskey.IChannelConnection<Misskey.Channels['smartTimeline']> | null = null;

let scrollContainer: HTMLElement | null = null;
const visibility = useDocumentVisibility();
const isPausingUpdate = ref(false);

function isTop(): boolean {
	if (scrollContainer == null) return true;
	if (rootEl.value == null) return true;
	const scrollTop = scrollContainer.scrollTop;
	return scrollTop <= 16;
}

const showModeIndicator = computed(() => props.showModeIndicator && $i);
const showScoreIndicator = computed(() => props.showScoreIndicator && $i);

function prepend(note: Misskey.entities.Note) {
	if (!note || notes.value.some(n => n.id === note.id)) return;

	if (isTop() && !isPausingUpdate.value) {
		notes.value.unshift(note);
		setupIntersectionObserver();
	} else {
		queuedNotes.value.unshift(note);
		if (queuedNotes.value.length > 32) {
			queuedNotes.value = queuedNotes.value.slice(0, 32);
		}
	}

	recordInteraction(note.id, 'view', {
		source: 'websocket_stream',
		algorithm: props.algorithm,
		timestamp: Date.now()
	}).catch(() => {});
}

function connectToStream() {
	if (!stream || !$i || connection) return;

	try {
		connection = stream.useChannel('smartTimeline', {
			algorithm: props.algorithm,
			diversityLevel: props.diversityLevel,
			freshnessWeight: props.freshnessWeight,
			qualityThreshold: props.qualityThreshold,
			withRenotes: true,
			withReplies: false,
			withFiles: false,
		});

		connection.on('note', prepend);
	} catch (error) {
		console.error('Failed to connect to smart timeline stream:', error);
	}
}

function disconnectFromStream() {
	if (connection) {
		connection.dispose();
		connection = null;
	}
}

async function init() {
	loading.value = true;
	error.value = false;
	// const isInitialLoad = offset.value === 0;
	offset.value = 0;

	try {
		const result = await misskeyApi('notes/smart-timeline', {
			limit: 20,
			algorithm: props.algorithm,
			diversityLevel: props.diversityLevel,
			freshnessWeight: props.freshnessWeight,
			qualityThreshold: props.qualityThreshold,
			enableCrossTimelineData: prefer.s.enableCrossTimelineData ?? true,
		}) as SmartTimelineResponse;

		if (isSmartTimelineWithScores(result)) {
			notes.value = result.notes;
			scores.value = result.scores || {};
			hasMore.value = result.notes.length >= 20;
			offset.value = result.notes.length;
		} else {
			notes.value = result;
			scores.value = {};
			hasMore.value = result.length >= 20;
			offset.value = result.length;
		}
		currentMode.value = { type: 'smart', smartRatio: 1.0, reason: i18n.ts._smartTimeline.smartAlgorithmActive };

		setupIntersectionObserver();
	} catch (err) {
		console.error('Failed to load smart timeline:', err);
		error.value = true;
	} finally {
		loading.value = false;
	}
}

function setupIntersectionObserver() {
	if (noteObserver.value) {
		noteObserver.value.disconnect();
	}

	noteObserver.value = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			const noteEl = entry.target as HTMLElement;
			const noteId = noteEl.getAttribute('data-scroll-anchor');

			if (!noteId) return;

			if (entry.isIntersecting) {
				noteViewTimes.value[noteId] = Date.now();
			} else if (noteViewTimes.value[noteId]) {
				const dwellTime = Date.now() - noteViewTimes.value[noteId];
				delete noteViewTimes.value[noteId];

				if (dwellTime > 1000) {
					recordDwellTime(noteId, dwellTime, entry.intersectionRatio);
				}
			}
		});
	}, {
		threshold: [0, 0.5, 1.0],
		rootMargin: '0px'
	});

	if (rootEl.value) {
		const noteElements = rootEl.value.querySelectorAll('[data-scroll-anchor]');
		noteElements.forEach(el => noteObserver.value?.observe(el));
	}
}

async function recordDwellTime(noteId: string, dwellTime: number, _maxVisibility: number) {
	if (!$i) return;

	try {
		await misskeyApi('notes/interaction', {
			targetId: noteId,
			interactionType: 'view',
			targetType: 'note',
			duration: Math.round(dwellTime / 1000),
			source: 'smart-timeline-component',
		});
	} catch (err) {
		console.debug('Failed to record dwell time:', err);
	}
}

async function fetchMore() {
	if (fetchingMore.value || !hasMore.value) return;

	fetchingMore.value = true;

	try {
		const result = await misskeyApi('notes/smart-timeline', {
			limit: 20,
			offset: offset.value,
			algorithm: props.algorithm,
			diversityLevel: props.diversityLevel,
			freshnessWeight: props.freshnessWeight,
			qualityThreshold: props.qualityThreshold,
			enableCrossTimelineData: prefer.s.enableCrossTimelineData ?? true,
		}) as SmartTimelineResponse;

		if (isSmartTimelineWithScores(result)) {
			notes.value.push(...result.notes);
			Object.assign(scores.value, result.scores || {});
			hasMore.value = result.notes.length >= 20;
			offset.value += result.notes.length;
		} else {
			// Result is directly an array of notes
			notes.value.push(...result);
			hasMore.value = result.length >= 20;
			offset.value += result.length;
		}

		setupIntersectionObserver();
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

type InteractionType = Misskey.Endpoints['notes/interaction']['req']['interactionType'];
type InteractionContext = Record<string, unknown>;

async function recordInteraction(noteId: string, type: InteractionType, context?: InteractionContext) {
	if (!$i) return;

	try {
		const payload = {
			targetId: noteId,
			interactionType: type,
			targetType: 'note',
			source: context?.source || 'smart-timeline',
			...context,
		} as Misskey.Endpoints['notes/interaction']['req'];

		await misskeyApi('notes/interaction', payload);
	} catch (err) {
		console.debug('Failed to record interaction:', err);
		// Don't show error to user for interaction recording failures
	}
}

function getModeIcon(type?: string): string {
	switch (type) {
		case 'smart': return 'ti ti-brain';
		case 'mixed': return 'ti ti-adjustments';
		case 'chronological': return 'ti ti-clock';
		default: return 'ti ti-sparkles';
	}
}

function getModeText(type?: string): string {
	switch (type) {
		case 'smart': return i18n.ts._smartTimeline.smartMode;
		case 'mixed': return i18n.ts._smartTimeline.mixedMode;
		case 'chronological': return i18n.ts._smartTimeline.chronologicalMode;
		default: return i18n.ts._smartTimeline.autoMode;
	}
}

async function openSettings() {
	const { canceled, result } = await os.form(i18n.ts.settings, {
		algorithm: {
			type: 'enum',
			label: i18n.ts._smartTimeline.algorithm,
			enum: [
				{ label: i18n.ts._smartTimeline.smart, value: 'smart' },
				{ label: i18n.ts._smartTimeline.hybrid, value: 'hybrid' },
				{ label: i18n.ts._smartTimeline.social, value: 'social' },
				{ label: i18n.ts._smartTimeline.discovery, value: 'discovery' },
			],
			default: props.algorithm,
		},
		diversityLevel: {
			type: 'enum',
			label: i18n.ts._smartTimeline.diversityLevel,
			enum: [
				{ label: i18n.ts.low, value: 'low' },
				{ label: i18n.ts.medium, value: 'medium' },
				{ label: i18n.ts.high, value: 'high' },
			],
			default: props.diversityLevel,
		},
		freshnessWeight: {
			type: 'range',
			label: i18n.ts._smartTimeline.freshnessWeight,
			min: 0,
			max: 1,
			step: 0.1,
			default: props.freshnessWeight,
		},
		qualityThreshold: {
			type: 'range',
			label: i18n.ts._smartTimeline.qualityThreshold,
			min: 0,
			max: 1,
			step: 0.1,
			default: props.qualityThreshold,
		},
		showScoreIndicator: {
			type: 'boolean',
			label: i18n.ts._smartTimeline.showScoreIndicator,
			default: props.showScoreIndicator,
		},
	});

		if (!canceled) {
			try {
				const payload: Misskey.Endpoints['i/update-timeline-preferences']['req'] = {
					algorithm: result.algorithm as 'smart' | 'hybrid' | 'social' | 'discovery',
					diversityLevel: result.diversityLevel as 'low' | 'medium' | 'high',
					freshnessWeight: result.freshnessWeight,
					qualityThreshold: result.qualityThreshold,
					showScoreIndicator: result.showScoreIndicator,
				};

				await misskeyApi('i/update-timeline-preferences', payload);

			Object.assign(props, result);

			reloadTimeline();

			os.toast(i18n.ts._smartTimeline.settingsSavedSucc);
		} catch (err) {
			os.alert({
				type: 'error',
				text: i18n.ts._smartTimeline.settingsSaveFailed,
			});
		}
	}
}

let refreshInterval: number | null = null;

watch(visibility, () => {
	if (visibility.value === 'hidden') {
		isPausingUpdate.value = true;
	} else {
		isPausingUpdate.value = false;
		if (isTop()) {
			releaseQueue();
		}
	}
});

onMounted(() => {
	init();

	scrollContainer = window.document.getElementById('misskey_app') || window.document.documentElement;

	if (store.s.realtimeMode) {
		connectToStream();
	}

	if (props.autoRefresh && !store.s.realtimeMode) {
		refreshInterval = window.setInterval(() => {
			if (window.document.visibilityState === 'visible') {
				reloadTimeline();
			}
		}, 5 * 60 * 1000); // 5 minutes
	}
});

onUnmounted(() => {
	disconnectFromStream();

	if (refreshInterval) {
		window.clearInterval(refreshInterval);
	}

	if (noteObserver.value) {
		noteObserver.value.disconnect();
		noteObserver.value = null;
	}

	noteViewTimes.value = {};
});

watch([() => props.algorithm, () => props.diversityLevel, () => props.freshnessWeight, () => props.qualityThreshold], () => {
	init();

	if (store.s.realtimeMode) {
		disconnectFromStream();
		connectToStream();
	}
});

defineExpose({
	reloadTimeline,
});
</script>

<style lang="scss" module>
.modeIndicator {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 16px;
	margin-bottom: 8px;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	border: 1px solid var(--MI_THEME-divider);
}

.modeInfo {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);

	i {
		color: var(--MI_THEME-accent);
	}
}

.ratio {
	padding: 2px 6px;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	border-radius: 4px;
	font-size: 0.8em;
	font-weight: bold;
}

.settingsButton {
	padding: 4px;
	border-radius: 4px;
	color: var(--MI_THEME-fgTransparentWeak);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		color: var(--MI_THEME-fg);
	}
}

.scoreIndicator {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 16px;
	font-size: 0.8em;
	color: var(--MI_THEME-fgTransparentWeak);
}

.scoreBar {
	flex: 1;
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

.scoreUnknown {
	height: 100%;
	background: var(--MI_THEME-accent);
	transition: width 0.3s ease;
}

.scoreText {
	min-width: 30px;
	text-align: right;
	font-weight: bold;
}

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

.notes {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.note {
	border-bottom: 1px solid var(--MI_THEME-divider);

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
</style>
