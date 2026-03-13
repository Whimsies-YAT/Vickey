<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<div class="_spacer" style="--MI_SPACER-w: 600px;">
		<div style="text-align: center; margin-bottom: 16px;">
			<b><MkUserName :user="game.user1"/></b> vs <b><MkUserName :user="game.user2"/></b>
		</div>

		<div class="_panel" style="padding: 32px; text-align: center;">
			<div style="font-size: 1.5em; font-weight: bold; margin-bottom: 24px;">
				<i class="ti ti-circles"></i> {{ i18n.ts._gomoku.title }}
			</div>

			<div class="_gaps" style="margin-bottom: 24px;">
				<div style="display: flex; gap: 16px; justify-content: center;">
					<div class="_panel" style="padding: 16px; flex: 1; max-width: 200px;">
						<MkAvatar :user="game.user1" style="width: 64px; height: 64px; margin: 0 auto 8px;"/>
						<div><MkUserName :user="game.user1"/></div>
						<div style="margin-top: 8px; opacity: 0.7;">{{ i18n.ts._gomoku.black }}</div>
						<div v-if="user1Ready" style="margin-top: 8px; color: var(--MI_THEME-accent);">
							<i class="ti ti-check"></i> {{ i18n.ts._gomoku.ready }}
						</div>
					</div>

					<div class="_panel" style="padding: 16px; flex: 1; max-width: 200px;">
						<MkAvatar :user="game.user2" style="width: 64px; height: 64px; margin: 0 auto 8px;"/>
						<div><MkUserName :user="game.user2"/></div>
						<div style="margin-top: 8px; opacity: 0.7;">{{ i18n.ts._gomoku.white }}</div>
						<div v-if="user2Ready" style="margin-top: 8px; color: var(--MI_THEME-accent);">
							<i class="ti ti-check"></i> {{ i18n.ts._gomoku.ready }}
						</div>
					</div>
				</div>
			</div>

			<div style="opacity: 0.7; margin-bottom: 16px;">
				<template v-if="isReady && isOpReady">{{ i18n.ts._gomoku.thisGameIsStartedSoon }}<MkEllipsis/></template>
				<template v-if="isReady && !isOpReady">{{ i18n.ts._gomoku.waitingForOther }}<MkEllipsis/></template>
				<template v-if="!isReady && isOpReady">{{ i18n.ts._gomoku.waitingForMe }}</template>
				<template v-if="!isReady && !isOpReady">{{ i18n.ts._gomoku.waitingBoth }}<MkEllipsis/></template>
			</div>
		</div>
	</div>
	<template #footer>
		<div :class="$style.footer">
			<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 16px;">
				<div style="text-align: center;" class="_gaps_s">
					<div class="_buttonsCenter">
						<MkButton rounded danger @click="cancel">{{ i18n.ts.cancel }}</MkButton>
						<MkButton v-if="!isReady" rounded primary @click="ready">{{ i18n.ts._gomoku.ready }}</MkButton>
						<MkButton v-if="isReady" rounded @click="unready">{{ i18n.ts._gomoku.cancelReady }}</MkButton>
					</div>
					<div>
						<MkSwitch v-model="shareWhenStart">{{ i18n.ts._gomoku.shareToTlTheGameWhenStart }}</MkSwitch>
					</div>
				</div>
			</div>
		</div>
	</template>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { computed, watch, ref, onMounted, shallowRef, onUnmounted } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { deepClone } from '@/utility/clone.js';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import * as os from '@/os.js';
import { useRouter } from '@/router.js';

const $i = ensureSignin();

const router = useRouter();

const props = defineProps<{
	game: Misskey.entities.GomokuGameDetailed;
	connection: Misskey.IChannelConnection<Misskey.Channels['gomokuGame']>;
}>();

type GomokuConnection = Misskey.IChannelConnection<Misskey.Channels['gomokuGame']> & {
	send: (type: string, payload: any) => void;
};

const shareWhenStart = defineModel<boolean>('shareWhenStart', { default: false });

const game = ref<Misskey.entities.GomokuGameDetailed>(deepClone(props.game));

const user1Ready = computed(() => game.value.user1Ready);
const user2Ready = computed(() => game.value.user2Ready);

const isReady = computed(() => {
	if (game.value.user1Id === $i.id && game.value.user1Ready) return true;
	if (game.value.user2Id === $i.id && game.value.user2Ready) return true;
	return false;
});

const isOpReady = computed(() => {
	if (game.value.user1Id !== $i.id && game.value.user1Ready) return true;
	if (game.value.user2Id !== $i.id && game.value.user2Ready) return true;
	return false;
});

async function cancel() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.areYouSure,
	});
	if (canceled) return;

	(props.connection as GomokuConnection).send('cancel', {});

	router.push('/gomoku');
}

function ready() {
	(props.connection as GomokuConnection).send('ready', true);
}

function unready() {
	(props.connection as GomokuConnection).send('ready', false);
}

function onChangeReadyStates(states: { user1: boolean; user2: boolean }) {
	game.value.user1Ready = states.user1;
	game.value.user2Ready = states.user2;
}

const conn = props.connection as any;
conn.on('changeReadyStates', onChangeReadyStates);

onUnmounted(() => {
	conn.off('changeReadyStates', onChangeReadyStates);
});
</script>

<style lang="scss" module>
.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	border-top: solid 0.5px var(--MI_THEME-divider);
}
</style>
