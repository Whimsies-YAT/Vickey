<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<XBanner v-for="media in mediaList.filter(media => !previewable(media))" :key="media.id" :media="media"/>
	<div v-if="mediaList.filter(media => previewable(media)).length > 0" :class="$style.container">
		<div
			ref="gallery"
			:class="[
				$style.medias,
				count === 1 ? [$style.n1, {
					[$style.n116_9]: prefer.s.mediaListWithOneImageAppearance === '16_9',
					[$style.n11_1]: prefer.s.mediaListWithOneImageAppearance === '1_1',
					[$style.n12_3]: prefer.s.mediaListWithOneImageAppearance === '2_3',
				}] : count === 2 ? $style.n2 : count === 3 ? $style.n3 : count === 4 ? $style.n4 : $style.nMany,
			]"
		>
			<template v-for="media in mediaList.filter(media => previewable(media))">
				<XVideo v-if="media.type.startsWith('video')" :key="`video:${media.id}`" :class="$style.media" :video="media"/>
				<XImage v-else-if="media.type.startsWith('image')" :key="`image:${media.id}`" :class="$style.media" class="image" :data-id="media.id" :image="media" :raw="raw"/>
			</template>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, useTemplateRef, ref } from 'vue';
import * as Misskey from 'misskey-js';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
import heic2any from 'heic2any';
import { FILE_TYPE_BROWSERSAFE } from '@@/js/const.js';
import XBanner from '@/components/MkMediaBanner.vue';
import XImage from '@/components/MkMediaImage.vue';
import XVideo from '@/components/MkMediaVideo.vue';
import * as os from '@/os.js';
import { focusParent } from '@/utility/focus.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	mediaList: Misskey.entities.DriveFile[];
	raw?: boolean;
}>();

const gallery = useTemplateRef('gallery');
const pswpZIndex = os.claimZIndex('middle');
window.document.documentElement.style.setProperty('--mk-pswp-root-z-index', pswpZIndex.toString());
const count = computed(() => props.mediaList.filter(media => previewable(media)).length);
let lightbox: PhotoSwipeLightbox | null = null;

let activeEl: HTMLElement | null = null;

const heicCache = new Map<string, { url: string; width: number; height: number }>();
const convertedMediaList = ref<Misskey.entities.DriveFile[]>(props.mediaList);

const convertHeicToJpeg = async (url: string, thumbnailUrl?: string): Promise<{ url: string; width: number; height: number }> => {
	if (heicCache.has(url)) {
		return heicCache.get(url)!;
	}

	try {
		const response = await window.fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const contentLength = response.headers.get('Content-Length');
		if (contentLength) {
			console.log(`[HEIC] Fetching: ${contentLength} bytes`);
		}

		const blob = await response.blob();

		if (contentLength && blob.size !== parseInt(contentLength, 10)) {
			console.warn(`[HEIC] Size mismatch: expected ${contentLength}, got ${blob.size}`);
		}

		const convertedBlob = await heic2any({
			blob,
			toType: 'image/jpeg',
			quality: 0.9,
		}) as Blob;
		const convertedUrl = URL.createObjectURL(convertedBlob);

		// Load the converted image to get its actual dimensions
		const img = new Image();
		const dimensionPromise = new Promise<{ width: number; height: number }>((resolve, reject) => {
			img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
			img.onerror = reject;
		});
		img.src = convertedUrl;
		const dimensions = await dimensionPromise;

		const result = { url: convertedUrl, width: dimensions.width, height: dimensions.height };
		heicCache.set(url, result);
		return result;
	} catch (error) {
		console.error('[HEIC] Conversion failed:', {
			error: error instanceof Error ? error.message : String(error),
			hasThumbnail: !!thumbnailUrl,
		});
		// Return fallback with dimensions of 1x1 (will be corrected by PhotoSwipe)
		return { url: thumbnailUrl ?? url, width: 1, height: 1 };
	}
};

const popstateHandler = (): void => {
	if (lightbox?.pswp && lightbox.pswp.isOpen === true) {
		lightbox.pswp.close();
	}
};

async function calcAspectRatio() {
	if (!gallery.value) return;

	const img = props.mediaList[0];

	if (props.mediaList.length !== 1 || !(img.properties.width && img.properties.height)) {
		gallery.value.style.aspectRatio = '';
		return;
	}

	const ratioMax = (ratio: number) => {
		if (img.properties.width == null || img.properties.height == null) return '';
		return `${Math.max(ratio, img.properties.width / img.properties.height).toString()} / 1`;
	};

	switch (prefer.s.mediaListWithOneImageAppearance) {
		case '16_9':
			gallery.value.style.aspectRatio = ratioMax(16 / 9);
			break;
		case '1_1':
			gallery.value.style.aspectRatio = ratioMax(1 / 1);
			break;
		case '2_3':
			gallery.value.style.aspectRatio = ratioMax(2 / 3);
			break;
		default:
			gallery.value.style.aspectRatio = '';
			break;
	}
}

onMounted(async () => {
	calcAspectRatio();

	if (gallery.value == null) return; // TSを黙らすため

	const processedMediaList = await Promise.all(
		props.mediaList
			.filter(media => {
				if (media.type === 'image/svg+xml') return true; // svgのwebpublicはpngなのでtrue
				if (media.type === 'image/heic' || media.type === 'image/heif') return true;
				return media.type.startsWith('image') && FILE_TYPE_BROWSERSAFE.includes(media.type);
			})
			.map(async media => {
				let src = media.url;
				let w = media.properties.width;
				let h = media.properties.height;

				if (media.type === 'image/heic' || media.type === 'image/heif') {
					const converted = await convertHeicToJpeg(media.url, media.thumbnailUrl);
					src = converted.url;
					w = converted.width;
					h = converted.height;
				}

				const item = {
					src,
					w,
					h,
					alt: media.comment ?? media.name,
					comment: media.comment ?? media.name,
				};
				if (media.properties.orientation != null && media.properties.orientation >= 5) {
					[item.w, item.h] = [item.h, item.w];
				}
				return item;
			})
	);

	lightbox = new PhotoSwipeLightbox({
		dataSource: processedMediaList,
		gallery: gallery.value,
		mainClass: 'pswp',
		children: '.image',
		thumbSelector: '.image',
		loop: false,
		padding: window.innerWidth > 500 ? {
			top: 32,
			bottom: 90,
			left: 32,
			right: 32,
		} : {
			top: 0,
			bottom: 78,
			left: 0,
			right: 0,
		},
		imageClickAction: 'close',
		tapAction: 'close',
		bgOpacity: 1,
		showAnimationDuration: 100,
		hideAnimationDuration: 100,
		returnFocus: false,
		pswpModule: PhotoSwipe,
	});

	lightbox.addFilter('itemData', (itemData) => {
		// element is children
		const { element } = itemData;

		const id = element?.dataset.id;
		const file = props.mediaList.find(media => media.id === id);
		if (!file) return itemData;

		const fileIndex = props.mediaList
			.filter(media => {
				if (media.type === 'image/svg+xml') return true;
				if (media.type === 'image/heic' || media.type === 'image/heif') return true;
				return media.type.startsWith('image') && FILE_TYPE_BROWSERSAFE.includes(media.type);
			})
			.findIndex(media => media.id === id);

		if (fileIndex >= 0 && processedMediaList[fileIndex]) {
			const processedItem = processedMediaList[fileIndex];
			itemData.src = processedItem.src;
			itemData.w = processedItem.w;
			itemData.h = processedItem.h;
			itemData.alt = processedItem.alt;
			itemData.comment = processedItem.comment;
		}

		itemData.msrc = file.thumbnailUrl ?? undefined;
		itemData.thumbCropped = true;

		return itemData;
	});

	lightbox.on('uiRegister', () => {
		lightbox?.pswp?.ui?.registerElement({
			name: 'altText',
			className: 'pswp__alt-text-container',
			appendTo: 'wrapper',
			onInit: (el, pswp) => {
				const textBox = window.document.createElement('p');
				textBox.className = 'pswp__alt-text _acrylic';
				el.appendChild(textBox);

				pswp.on('change', () => {
					textBox.textContent = pswp.currSlide?.data.comment;
				});
			},
		});
	});

	lightbox.on('afterInit', () => {
		activeEl = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
		focusParent(activeEl, true, true);
		lightbox?.pswp?.element?.focus({
			preventScroll: true,
		});
		window.history.pushState(null, '', '#pswp');
	});

	lightbox.on('destroy', () => {
		focusParent(activeEl, true, false);
		activeEl = null;
		if (window.location.hash === '#pswp') {
			window.history.back();
		}
	});

	window.addEventListener('popstate', popstateHandler);

	lightbox.init();
});

onUnmounted(() => {
	window.removeEventListener('popstate', popstateHandler);
	lightbox?.destroy();
	lightbox = null;
	activeEl = null;
	heicCache.forEach(({ url }) => URL.revokeObjectURL(url));
	heicCache.clear();
});

const previewable = (file: Misskey.entities.DriveFile): boolean => {
	if (file.type === 'image/svg+xml') return true;
	// svgのwebpublic/thumbnailはpngなのでtrue
	// FILE_TYPE_BROWSERSAFEに適合しないものはブラウザで表示するのに不適切
	if (file.type === 'image/heic' || file.type === 'image/heif') return true;
	return (file.type.startsWith('video') || file.type.startsWith('image')) && FILE_TYPE_BROWSERSAFE.includes(file.type);
};

const openGallery = () => {
	if (props.mediaList.filter(media => previewable(media)).length > 0) {
		lightbox?.loadAndOpen(0);
	}
};

defineExpose({
	openGallery,
});
</script>

<style lang="scss" module>
.container {
	position: relative;
	width: 100%;
}

.medias {
	display: grid;
	grid-gap: 8px;

	height: 100%;
	width: 100%;

	&.n1 {
		grid-template-rows: 1fr;

		// default but fallback (expand)
		min-height: 64px;
		max-height: clamp(
			64px,
			50cqh,
			min(360px, 50vh)
		);

		&.n116_9 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 16 / 9; // fallback
		}

		&.n11_1{
			min-height: initial;
			max-height: initial;
			aspect-ratio: 1 / 1; // fallback
		}

		&.n12_3 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 2 / 3; // fallback
		}
	}

	&.n2 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr;
	}

	&.n3 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 0.5fr;
		grid-template-rows: 1fr 1fr;

		> .media:nth-child(1) {
			grid-row: 1 / 3;
		}

		> .media:nth-child(3) {
			grid-column: 2 / 3;
			grid-row: 2 / 3;
		}
	}

	&.n4 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	&.nMany {
		grid-template-columns: 1fr 1fr;

		> .media {
			aspect-ratio: 16/9;
		}
	}
}

.media {
	overflow: hidden; // clipにするとバグる
	border-radius: 8px;
}

:global(.pswp) {
	--pswp-root-z-index: var(--mk-pswp-root-z-index, 2000700) !important;
	--pswp-bg: var(--MI_THEME-modalBg) !important;
}
</style>

<style lang="scss">
.pswp__bg {
	background: var(--MI_THEME-modalBg);
	backdrop-filter: var(--MI-modalBgFilter);
}

.pswp__alt-text-container {
	display: flex;
	flex-direction: row;
	align-items: center;

	position: absolute;
	bottom: 20px;
	left: 50%;
	transform: translateX(-50%);

	width: 75%;
	max-width: 800px;
}

.pswp__alt-text {
	color: var(--MI_THEME-fg);
	margin: 0 auto;
	text-align: center;
	padding: var(--MI-margin);
	border-radius: var(--MI-radius);
	max-height: 8em;
	overflow-y: auto;
	text-shadow: var(--MI_THEME-bg) 0 0 10px, var(--MI_THEME-bg) 0 0 3px, var(--MI_THEME-bg) 0 0 3px;
	white-space: pre-line;
}
</style>
