<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<div v-if="hasLocationData" class="note-location">
		<i class="ti ti-map-pin location-icon"></i>
		<span class="location-text">{{ formatLocationText }}</span>
	</div>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { $i } from '@/i.js';

const props = defineProps<{
	geojson?: Record<string, any> | null;
}>();

const containerRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
const resizeObserver = ref<ResizeObserver | null>(null);

interface LocationInfo {
	country?: string;
	state?: string;
	county?: string;
	city?: string;
	district?: string;
	name?: string;
}

const locationInfo = computed<LocationInfo>(() => {
	if (!props.geojson) return {};

	if (props.geojson.type === 'FeatureCollection' && props.geojson.features?.length > 0) {
		const firstFeature = props.geojson.features[0];
		if (firstFeature.properties) {
			return extractLocationInfo(firstFeature.properties);
		}
	}

	if (props.geojson.type === 'Feature' && props.geojson.properties) {
		return extractLocationInfo(props.geojson.properties);
	}

	if (props.geojson.country || props.geojson.state || props.geojson.city || props.geojson.district) {
		return extractLocationInfo(props.geojson);
	}

	return {};
});

function extractLocationInfo(properties: any): LocationInfo {
	const info: LocationInfo = {};

	if (properties.country) {
		info.country = properties.country;
	}

	if (properties.state) {
		info.state = properties.state;
	}

	if (properties.county) {
		info.county = properties.county;
	}

	if (properties.city) {
		info.city = properties.city;
	}

	if (properties.district) {
		info.district = properties.district;
	}

	if (properties.name) {
		info.name = properties.name;
	}

	return info;
}

const hasLocationData = computed(() => {
	const info = locationInfo.value;
	return !!(info.country || info.state || info.city || info.district);
});

const formatLocationText = computed(() => {
	const info = locationInfo.value;
	if (!hasLocationData.value) return '';

	const userLang = $i?.lang || navigator.language || 'en-US';
	const langCode = userLang.split('-')[0];
	const isWestern = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'et', 'lv', 'lt'].includes(langCode);
	const parts: string[] = [];

	if (isWestern) {
		if (info.name) parts.push(info.name);
		if (info.district) parts.push(info.district);
		if (info.city) parts.push(info.city);
		if (info.county) parts.push(info.county);
		if (info.state) parts.push(info.state);
		if (info.country) parts.push(info.country);
	} else {
		if (info.country) parts.push(info.country);
		if (info.state) parts.push(info.state);
		if (info.county) parts.push(info.county);
		if (info.city) parts.push(info.city);
		if (info.district) parts.push(info.district);
		if (info.name) parts.push(info.name);
	}

	return parts.join(', ');
});

const displayLocationText = computed(() => {
	const fullText = formatLocationText.value;
	if (!fullText || containerWidth.value === 0) return fullText;

	const maxTextWidth = containerWidth.value - 30;

	// 根据容器宽度决定显示策略
	if (maxTextWidth < 80) {
		// 极小空间：只显示最重要的信息
		const info = locationInfo.value;
		if (info.city) return info.city;
		if (info.district) return info.district;
		if (info.state) return info.state;
		if (info.country) return info.country;
		return fullText;
	} else if (maxTextWidth < 150) {
		const info = locationInfo.value;
		const userLang = $i?.lang || navigator.language || 'en-US';
		const langCode = userLang.split('-')[0];
		const isWestern = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'et', 'lv', 'lt'].includes(langCode);

		const shortParts: string[] = [];
		if (isWestern) {
			if (info.city) shortParts.push(info.city);
			if (info.country) shortParts.push(info.country);
		} else {
			if (info.country) shortParts.push(info.country);
			if (info.city) shortParts.push(info.city);
		}

		return shortParts.length > 0 ? shortParts.join(', ') : fullText;
	} else if (maxTextWidth < 250) {
		const info = locationInfo.value;
		const userLang = $i?.lang || navigator.language || 'en-US';
		const langCode = userLang.split('-')[0];
		const isWestern = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'et', 'lv', 'lt'].includes(langCode);

		const mediumParts: string[] = [];
		if (isWestern) {
			if (info.district) mediumParts.push(info.district);
			if (info.city) mediumParts.push(info.city);
			const stateOrCountry = info.state || info.country;
			if (stateOrCountry) mediumParts.push(stateOrCountry);
		} else {
			const stateOrCountry = info.state || info.country;
			if (stateOrCountry) mediumParts.push(stateOrCountry);
			if (info.city) mediumParts.push(info.city);
			if (info.district) mediumParts.push(info.district);
		}

		return mediumParts.length > 0 ? mediumParts.join(', ') : fullText;
	}

	return fullText;
});

onMounted(() => {
	if (containerRef.value) {
		containerWidth.value = containerRef.value.offsetWidth;

		resizeObserver.value = new ResizeObserver((entries) => {
			for (const entry of entries) {
				containerWidth.value = entry.contentRect.width;
			}
		});

		resizeObserver.value.observe(containerRef.value);
	}
});

onUnmounted(() => {
	if (resizeObserver.value && containerRef.value) {
		resizeObserver.value.unobserve(containerRef.value);
		resizeObserver.value.disconnect();
	}
});
</script>

<style lang="scss" scoped>
.note-location {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	margin-top: 4px;
	padding: 2px 6px;
	border: 1px solid var(--divider);
	border-radius: 4px;
	background: var(--panel);
	font-size: 0.7em;
	opacity: 0.6;
	transition: opacity 0.2s ease;
	max-width: 100%;
	min-width: 0;

	.location-icon {
		font-size: 0.8em;
		color: var(--fgTransparentWeak);
		opacity: 0.7;
		flex-shrink: 0;
	}

	.location-text {
		color: var(--fgTransparentWeak);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		transition: all 0.2s ease;
	}

	&:hover {
		opacity: 0.85;

		.location-icon,
		.location-text {
			color: var(--fg);
		}
	}
}
</style>
