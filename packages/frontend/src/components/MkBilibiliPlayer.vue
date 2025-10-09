<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<MkWindow :initialWidth="640" :initialHeight="402" :canResize="true" :closeButton="true">
		<template #header>
			<i class="icon ti ti-brand-bilibili" style="margin-right: 0.5em;"></i>
			<span>{{ title ?? 'Bilibili' }}</span>
		</template>
		<div class="poamfof">
			<Transition :name="prefer.s.animation ? 'fade' : ''" mode="out-in">
				<div v-if="player.url && (player.url.startsWith('http://') || player.url.startsWith('https://'))" class="player">
					<iframe v-if="!fetching" :src="player.url" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
				</div>
				<span v-else>invalid url</span>
			</Transition>
			<MkLoading v-if="fetching"/>
			<MkError v-else-if="!player.url" @retry="bilibiliFetch()"/>
		</div>
	</MkWindow>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import MkWindow from '@/components/MkWindow.vue';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	url: string;
}>();

const requestUrl = new URL(props.url);
if (!['http:', 'https:'].includes(requestUrl.protocol)) throw new Error('invalid url');

const fetching = ref(true);
const title = ref<string | null>(null);
const player = ref({
	url: null as string | null,
	width: null as number | null,
	height: null as number | null,
});

const parseBilibiliUrl = async (inputUrl: string): Promise<{ bvid?: string; aid?: string } | null> => {
	try {
		if (inputUrl.includes('b23.tv')) {
			try {
				const response = await window.fetch(inputUrl, { method: 'HEAD', redirect: 'follow' });
				inputUrl = response.url;
			} catch (e) {
				console.warn('Failed to resolve short link');
			}
		}

		const url = new URL(inputUrl);

		const supportedDomains = [
			'bilibili.com',
			'www.bilibili.com',
			'm.bilibili.com',
			'b23.tv'
		];

		if (!supportedDomains.some(domain => url.hostname.endsWith(domain))) {
			return null;
		}

		const pathname = url.pathname;

		const bvMatch = pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
		if (bvMatch) {
			return { bvid: bvMatch[1] };
		}

		const avMatch = pathname.match(/\/video\/av(\d+)/);
		if (avMatch) {
			return { aid: avMatch[1] };
		}

		const searchParams = url.searchParams;
		const bvid = searchParams.get('bvid');
		const aid = searchParams.get('aid');

		if (bvid) {
			return { bvid };
		}

		if (aid) {
			return { aid };
		}

		if (url.hash) {
			const hashBvMatch = url.hash.match(/BV[a-zA-Z0-9]+/);
			if (hashBvMatch) {
				return { bvid: hashBvMatch[0] };
			}
		}

		return null;
	} catch (e) {
		console.error('Parse Bilibili URL failed:', e);
		return null;
	}
};

const buildEmbedUrl = (videoId: { bvid?: string; aid?: string }): string => {
	if (videoId.bvid) {
		return `https://player.bilibili.com/player.html?bvid=${videoId.bvid}&autoplay=0`;
	} else if (videoId.aid) {
		return `https://player.bilibili.com/player.html?aid=${videoId.aid}&autoplay=0`;
	}
	throw new Error('Invalid video ID');
};

const bilibiliFetch = async (): Promise<void> => {
	fetching.value = true;

	try {
		const videoId = await parseBilibiliUrl(props.url);

		if (!videoId) {
			throw new Error('Cannot extract video ID from URL');
		}

		const embedUrl = buildEmbedUrl(videoId);

		title.value = videoId.bvid ? `Bilibili - ${videoId.bvid}` : `Bilibili - av${videoId.aid}`;

		player.value = {
			url: embedUrl,
			width: 640,
			height: 360
		};

		fetching.value = false;
	} catch (e) {
		console.error('Fetch Bilibili video failed:', e);
		fetching.value = false;
	}
};

bilibiliFetch();
</script>

<style lang="scss">
.poamfof {
	position: relative;
	overflow: hidden;
	height: 100%;

	.player {
		position: absolute;
		inset: 0;

		iframe {
			width: 100%;
			height: 100%;
		}
	}
}
</style>
