<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.inline]: inline, [$style.colored]: colored, [$style.mini]: mini, [$style.em]: em }]">
	<div :class="$style.container">
		<svg :class="[$style.spinner, $style.bg]" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg">
			<circle cx="75" cy="75" r="60" style="fill:none;stroke:currentColor;stroke-width:7.5px;"/>
		</svg>
		<svg :class="[$style.spinner, $style.fg, { [$style.static]: static }]" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg">
			<circle cx="75" cy="75" r="60" style="fill:none;stroke:currentColor;stroke-width:7.5px;"/>
		</svg>
	</div>
</div>
</template>

<script lang="ts" setup>
import { } from 'vue';

const props = withDefaults(defineProps<{
	static?: boolean;
	inline?: boolean;
	colored?: boolean;
	mini?: boolean;
	em?: boolean;
}>(), {
	static: false,
	inline: false,
	colored: true,
	mini: false,
	em: false,
});
</script>

<style lang="scss" module>
.root {
	padding: 32px;
	text-align: center;
	cursor: wait;

	--size: 38px;

	&.colored {
		color: var(--MI_THEME-accent);
	}

	&.inline {
		display: inline;
		padding: 0;
		--size: 32px;
	}

	&.mini {
		padding: 16px;
		--size: 32px;
	}

	&.em {
		display: inline-block;
		vertical-align: middle;
		padding: 0;
		--size: 1em;
	}
}

.container {
	position: relative;
	width: var(--size);
	height: var(--size);
	margin: 0 auto;
	animation: globalSpinnerRotate 2s linear infinite;
}

.spinner {
	position: absolute;
	top: 0;
	left: 0;
	width: var(--size);
	height: var(--size);
	fill-rule: evenodd;
	clip-rule: evenodd;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-miterlimit: 1.5;
}

.bg {
	opacity: 0.275;
}

.fg {
	&.static {
		animation-play-state: paused;
	}

	circle {
		transform-origin: center;
		stroke-linecap: round;
		stroke-dasharray: 3, 600;
		stroke-dashoffset: 0;
		animation: mkLoadingDash 1.5s ease-in-out infinite;
	}
}

@keyframes mkLoadingDash {
	0% {
		stroke-dasharray: 3, 600;
		stroke-dashoffset: 0;
	}
	50% {
		stroke-dasharray: 267, 600;
		stroke-dashoffset: -105px;
	}
	100% {
		stroke-dasharray: 267, 600;
		stroke-dashoffset: -372px;
	}
}
</style>
