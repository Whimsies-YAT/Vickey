<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkResult v-if="error === 'notFound'" type="notFound" :text="i18n.ts.noSuchAntenna">
			<MkButton :class="$style.retryButton" rounded @click="fetchAntenna()">{{ i18n.ts.retry }}</MkButton>
		</MkResult>
		<MkError v-else-if="error === 'error'" @retry="fetchAntenna()"/>
		<div v-else :class="$style.tl">
			<MkStreamingNotesTimeline
				ref="tlEl" :key="antennaId"
				src="antenna"
				:antenna="antennaId"
				:sound="true"
			/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, ref, useTemplateRef, provide } from 'vue';
import * as Misskey from 'misskey-js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';

const router = useRouter();

const props = defineProps<{
	antennaId: string;
}>();

const antenna = ref<Misskey.entities.Antenna | null>(null);
const error = ref<'notFound' | 'error' | null>(null);
const tlEl = useTemplateRef('tlEl');

provide('currentAntenna', antenna);

function settings() {
	router.push('/my/antennas/:antennaId', {
		params: {
			antennaId: props.antennaId,
		},
	});
}

async function fetchAntenna() {
	try {
		antenna.value = await misskeyApi('antennas/show', {
			antennaId: props.antennaId,
		});
		error.value = null;
	} catch (err: any) {
		if (err.code === 'NO_SUCH_ANTENNA') {
			error.value = 'notFound';
		} else {
			error.value = 'error';
		}
	}
}

watch(() => props.antennaId, fetchAntenna, { immediate: true });

const headerActions = computed(() => antenna.value ? [{
	icon: 'ti ti-settings',
	text: i18n.ts.settings,
	handler: settings,
}] : []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: antenna.value ? antenna.value.name : i18n.ts.antennas,
	icon: 'ti ti-antenna',
}));
</script>

<style lang="scss" module>
.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.retryButton {
	margin: 0 auto;
}
</style>
