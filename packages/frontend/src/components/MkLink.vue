<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component
	:is="self ? 'MkA' : 'a'" ref="el" style="word-break: break-all;" class="_link" :[attr]="maybeRelativeUrl" :rel="rel ?? 'nofollow noopener'" :target="target"
	:behavior="props.navigationBehavior"
	:title="url"
	@click="handleClick"
>
	<slot></slot>
	<i v-if="target === '_blank'" class="ti ti-external-link" :class="$style.icon"></i>
</component>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, ref } from 'vue';
import { url as local } from '@@/js/config.js';
import { maybeMakeRelative } from '@@/js/url.js';
import type { MkABehavior } from '@/components/global/MkA.vue';
import { useTooltip } from '@/composables/use-tooltip.js';
import * as os from '@/os.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { isExternalLink } from '@/utility/external-link.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	url: string;
	rel?: null | string;
	navigationBehavior?: MkABehavior;
}>(), {
});

const maybeRelativeUrl = maybeMakeRelative(props.url, local);
const self = maybeRelativeUrl !== props.url;
const attr = self ? 'to' : 'href';
const target = self ? null : '_blank';

const el = ref<HTMLElement | { $el: HTMLElement }>();

async function handleClick(ev: MouseEvent) {
	if (self) return;

	if (isExternalLink(props.url)) {
		ev.preventDefault();
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts.externalLink,
			text: i18n.tsx.externalLinkWarning({ url: `\` ${props.url} \`` }),
			okText: i18n.ts.continue ?? 'Continue',
			cancelText: i18n.ts.cancel ?? 'Cancel',
		});

		if (!canceled) {
			window.open(props.url, '_blank', 'noopener');
		}
	}
}

if (isEnabledUrlPreview.value) {
	useTooltip(el, (showing) => {
		const anchorElement = el.value instanceof HTMLElement ? el.value : el.value?.$el;
		if (anchorElement == null) return;

		// Don't show preview tooltip if this link is inside a preview popup
		const isInPreviewPopup = anchorElement.closest?.('._popup');
		if (isInPreviewPopup) return;

		const isInDialog = anchorElement && (
			anchorElement.closest?.('[role="dialog"]') ||
			anchorElement.closest?.('.mk-modal') ||
			anchorElement.closest?.('[data-cy-modal-dialog-ok]')?.closest?.('.mk-modal')
		);

		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkUrlPreviewPopup.vue')), {
			showing,
			url: props.url,
			anchorElement: anchorElement,
			forceHighZIndex: !!isInDialog,
		}, {
			closed: () => dispose(),
		});
	});
}
</script>

<style lang="scss" module>
.icon {
	padding-left: 2px;
	font-size: .9em;
}
</style>
