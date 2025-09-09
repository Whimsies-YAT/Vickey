<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Transition
	:enterActiveClass="$style.transition_zoom_enterActive"
	:leaveActiveClass="$style.transition_zoom_leaveActive"
	:enterFromClass="$style.transition_zoom_enterFrom"
	:leaveToClass="$style.transition_zoom_leaveTo"
	:moveClass="$style.transition_zoom_move"
	mode="out-in"
>
	<div v-if="!gameStarted" class="_spacer" style="--MI_SPACER-w: 800px;">
		<div :class="$style.root">
			<div class="_gaps">
				<div class="_woodenFrame" style="text-align: center;">
					<div class="_woodenFrameInner">
						<div style="font-size: 2.5rem; font-weight: bold; margin: 2rem 0;">{{ i18n.ts._conway.title }}</div>
						<div style="color: var(--MI_THEME-fgTransparent); margin-bottom: 1rem;">
							{{ i18n.ts._conway.description }}
						</div>
					</div>
				</div>
				<div class="_woodenFrame" style="text-align: center;">
					<div class="_woodenFrameInner">
						<div class="_gaps" style="padding: 16px;">
							<div class="_gaps_s">
								<div style="font-weight: bold;">{{ i18n.ts._conway.gridSize }}</div>
								<MkSelect v-model="gridSize">
									<option value="32">{{ i18n.ts.small }} (32×32)</option>
									<option value="64">{{ i18n.ts.medium }} (64×64)</option>
									<option value="128">{{ i18n.ts.large }} (128×128)</option>
									<option value="256">{{ i18n.ts._conway.xLarge }} (256×256)</option>
								</MkSelect>
							</div>
							<div class="_gaps_s">
								<div style="font-weight: bold;">{{ i18n.ts._conway.startingPattern }}</div>
								<MkSelect v-model="startingPattern">
									<option value="random">{{ i18n.ts._conway.random }}</option>
									<option value="glider">{{ i18n.ts._conway.glider }}</option>
									<option value="blinker">{{ i18n.ts._conway.blinker }}</option>
									<option value="toad">{{ i18n.ts._conway.toad }}</option>
									<option value="beacon">{{ i18n.ts._conway.beacon }}</option>
									<option value="pulsar">{{ i18n.ts._conway.pulsar }}</option>
									<option value="pentadecathlon">{{ i18n.ts._conway.pentadecathlon }}</option>
									<option value="empty">{{ i18n.ts._conway.empty }}</option>
								</MkSelect>
							</div>
							<div class="_gaps_s">
								<div style="font-weight: bold;">{{ i18n.ts.speed }}</div>
								<MkSelect v-model="gameSpeed">
									<option value="slow">{{ i18n.ts._conway.slow }}</option>
									<option value="normal">{{ i18n.ts._conway.normal }}</option>
									<option value="fast">{{ i18n.ts._conway.fast }}</option>
									<option value="ultra">{{ i18n.ts._conway.ultra }}</option>
								</MkSelect>
							</div>
							<MkButton primary gradate large rounded inline @click="start">{{ i18n.ts.start }}</MkButton>
						</div>
					</div>
				</div>
				<div class="_woodenFrame">
					<div class="_woodenFrameInner" style="padding: 16px;">
						<div style="font-weight: bold; margin-bottom: 1rem;">{{ i18n.ts._conway.howToPlay }}</div>
						<div class="_gaps_s" style="font-size: 0.9rem;">
							<div>• {{ i18n.ts._conway.rules1 }}</div>
							<div>• {{ i18n.ts._conway.rules2 }}</div>
							<div>• {{ i18n.ts._conway.rules3 }}</div>
							<div style="margin-left: 1rem;">
								<div>{{ i18n.ts._conway.rules4 }}</div>
								<div>{{ i18n.ts._conway.rules5 }}</div>
								<div>{{ i18n.ts._conway.rules6 }}</div>
							</div>
							<div>• {{ i18n.ts._conway.rules7 }}</div>
							<div>• {{ i18n.ts._conway.rules8 }}</div>
						</div>
					</div>
				</div>
				<div class="_woodenFrame">
					<div class="_woodenFrameInner">
						<div class="_gaps_s" style="padding: 16px;">
							<div><b>{{ i18n.ts._conway.famousPatterns }}</b></div>
							<div style="font-size: 0.9rem;">
								<div>{{ i18n.ts._conway.patterns1 }}</div>
								<div>{{ i18n.ts._conway.patterns2 }}</div>
								<div>{{ i18n.ts._conway.patterns3 }}</div>
								<div>{{ i18n.ts._conway.patterns4 }}</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
	<XGame
		v-else
		:gridSize="parseInt(gridSize)"
		:startingPattern="startingPattern"
		:gameSpeed="gameSpeed"
		@end="onGameEnd"
	/>
</Transition>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import XGame from './conway-game-of-life.game.vue';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import MkSelect from '@/components/MkSelect.vue';

const gridSize = ref<string>('64');
const startingPattern = ref<string>('random');
const gameSpeed = ref<string>('normal');
const gameStarted = ref(false);

async function start() {
	gameStarted.value = true;
}

function onGameEnd() {
	gameStarted.value = false;
}

definePage(() => ({
	title: i18n.ts._conway.title,
	icon: 'ti ti-grid-3x3',
}));
</script>

<style lang="scss" module>
.transition_zoom_move,
.transition_zoom_enterActive,
.transition_zoom_leaveActive {
	transition: opacity 0.5s cubic-bezier(0,.5,.5,1), transform 0.5s cubic-bezier(0,.5,.5,1) !important;
}
.transition_zoom_enterFrom,
.transition_zoom_leaveTo {
	opacity: 0;
	transform: scale(0.8);
}

.root {
	margin: 0 auto;
	max-width: 600px;
	user-select: none;

	* {
		user-select: none;
	}
}
</style>
