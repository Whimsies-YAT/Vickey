<template>
	<div v-if="hasLocationData" class="note-location">
		<i class="ti ti-map-pin location-icon"></i>
		<span class="location-text">{{ formatLocationText }}</span>
	</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { $i } from '@/i.js';

const props = defineProps<{
	geojson?: Record<string, any> | null;
}>();

interface LocationInfo {
	country?: string;
	state?: string;
	city?: string;
	district?: string;
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

	if (properties.city) {
		info.city = properties.city;
	}

	if (properties.district) {
		info.district = properties.district;
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
		if (info.district) parts.push(info.district);
		if (info.city) parts.push(info.city);
		if (info.state) parts.push(info.state);
		if (info.country) parts.push(info.country);
	} else {
		if (info.country) parts.push(info.country);
		if (info.state) parts.push(info.state);
		if (info.city) parts.push(info.city);
		if (info.district) parts.push(info.district);
	}

	return parts.join(', ');
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
		max-width: 200px;
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
