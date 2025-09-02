<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component
	:is="self ? 'MkA' : 'a'" ref="el" :class="$style.root" class="_link" :[attr]="maybeRelativeUrl" :rel="rel ?? 'nofollow noopener'" :target="target"
	:behavior="props.navigationBehavior"
	@click="handleClick"
	@contextmenu.stop="() => {}"
>
	<template v-if="!self">
		<span :class="$style.schema">{{ schema }}//</span>
		<span :class="$style.hostname">{{ hostname }}</span>
		<span v-if="port != ''">:{{ port }}</span>
	</template>
	<template v-if="pathname === '/' && self">
		<span :class="$style.self">{{ hostname }}</span>
	</template>
	<span v-if="pathname != ''" :class="$style.pathname">{{ self ? pathname.substring(1) : pathname }}</span>
	<span :class="$style.query">{{ query }}</span>
	<span :class="$style.hash">{{ hash }}</span>
	<i v-if="target === '_blank'" :class="$style.icon" class="ti ti-external-link"></i>
</component>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, ref } from 'vue';
import { toUnicode as decodePunycode } from 'punycode.js';
import { url as local } from '@@/js/config.js';
import { maybeMakeRelative } from '@@/js/url.js';
import type { MkABehavior } from '@/components/global/MkA.vue';
import * as os from '@/os.js';
import { useTooltip } from '@/composables/use-tooltip.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { isExternalLink } from '@/utility/external-link.js';
import { i18n } from '@/i18n.js';

function safeURIDecode(str: string): string {
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}

const props = withDefaults(defineProps<{
	url: string;
	rel?: string;
	showUrlPreview?: boolean;
	navigationBehavior?: MkABehavior;
	inPreviewPopup?: boolean;
}>(), {
	showUrlPreview: true,
	inPreviewPopup: false,
});

const maybeRelativeUrl = maybeMakeRelative(props.url, local);
const self = maybeRelativeUrl !== props.url;
const url = new URL(props.url);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid url');
const el = ref();

if (props.showUrlPreview && isEnabledUrlPreview.value && !props.inPreviewPopup) {
	useTooltip(el, (showing) => {
		const isInDialog = el.value && (
			el.value.closest?.('[role="dialog"]') ||
			el.value.closest?.('.mk-modal') ||
			el.value.closest?.('[data-cy-modal-dialog-ok]')?.closest?.('.mk-modal')
		);

		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkUrlPreviewPopup.vue')), {
			showing,
			url: props.url,
			anchorElement: el.value instanceof HTMLElement ? el.value : el.value?.$el,
			forceHighZIndex: !!isInDialog,
		}, {
			closed: () => dispose(),
		});
	});
}

const schema = url.protocol;
const hostname = decodePunycode(url.hostname);
const port = url.port;
const pathname = safeURIDecode(url.pathname);
const query = safeURIDecode(url.search);
const hash = safeURIDecode(url.hash);
const attr = self ? 'to' : 'href';
const target = self ? null : '_blank';

async function handleClick(ev: MouseEvent) {
	if (self) return;

	// If we're in a preview popup, prevent everything
	if (props.inPreviewPopup) {
		ev.preventDefault();
		ev.stopPropagation();
		return;
	}

	if (!self && isExternalLink(props.url)) {
		ev.preventDefault();
		ev.stopPropagation();
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts.externalLink,
			text: i18n.tsx.externalLinkWarning({ url: `\` ${props.url} \`` }),
			okText: i18n.ts.continue,
			cancelText: i18n.ts.cancel,
		});

		if (!canceled) {
			window.open(props.url, '_blank', 'noopener,noreferrer');
		}
	}
}
</script>

<style lang="scss" module>
.root {
	word-break: break-all;
}

.icon {
	padding-left: 2px;
	font-size: .9em;
}

.self {
	font-weight: bold;
}

.schema {
	color: color(from currentcolor srgb r g b / 0.5); // DOMノード全体をopacityで半透明化するより文字色を半透明化した方が若干レンダリングパフォーマンスが良い
}

.hostname {
	font-weight: bold;
}

.pathname {
	color: color(from currentcolor srgb r g b / 0.8); // DOMノード全体をopacityで半透明化するより文字色を半透明化した方が若干レンダリングパフォーマンスが良い
}

.query {
	color: color(from currentcolor srgb r g b / 0.5); // DOMノード全体をopacityで半透明化するより文字色を半透明化した方が若干レンダリングパフォーマンスが良い
}

.hash {
	font-style: italic;
}
</style>
