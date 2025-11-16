<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkResult v-if="error === 'notFound'" type="notFound" :text="i18n.ts.noSuchGame">
	<MkButton :class="$style.retryButton" rounded @click="fetchGame()">{{ i18n.ts.retry }}</MkButton>
</MkResult>
<MkError v-else-if="error === 'error'" @retry="fetchGame()"/>
<div v-else-if="game == null || (!game.isEnded && connection == null)"><MkLoading/></div>
<GameSetting v-else-if="!game.isStarted" v-model:shareWhenStart="shareWhenStart" :game="game" :connection="connection!"/>
<GameBoard v-else :game="game" :connection="connection"/>
</template>

<script lang="ts" setup>
import { computed, watch, ref, onMounted, shallowRef, onUnmounted } from 'vue';
import * as Misskey from 'misskey-js';
import GameSetting from './game.setting.vue';
import GameBoard from './game.board.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { ensureSignin } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { url } from '@@/js/config.js';
import { i18n } from '@/i18n.js';
import { useInterval } from '@@/js/use-interval.js';

const $i = ensureSignin();

const router = useRouter();

const props = defineProps<{
	gameId: string;
}>();

const game = shallowRef<Misskey.entities.GomokuGameDetailed | null>(null);
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['gomokuGame']> | null>(null);
const shareWhenStart = ref(false);
const error = ref<'notFound' | 'error' | null>(null);

watch(() => props.gameId, () => {
	fetchGame();
});

function start(_game: Misskey.entities.GomokuGameDetailed) {
	if (game.value?.isStarted) return;

	if (shareWhenStart.value) {
		misskeyApi('notes/create', {
			text: `${i18n.ts._gomoku.iStartedAGame}\n${url}/gomoku/g/${props.gameId}`,
			visibility: 'home',
		});
	}

	game.value = _game;
}

async function fetchGame() {
	try {
		const _game = await misskeyApi('gomoku/show-game', {
			gameId: props.gameId,
		});

		game.value = _game as Misskey.entities.GomokuGameDetailed;
		shareWhenStart.value = false;
		error.value = null;

		if (connection.value) {
			connection.value.dispose();
		}
		if (!game.value.isEnded) {
			connection.value = useStream().useChannel('gomokuGame', {
				gameId: game.value.id,
			});
			connection.value.on('started', x => {
				start(x.game);
			});
			connection.value.on('canceled', x => {
				connection.value?.dispose();

				if (x.userId !== $i.id) {
					os.alert({
						type: 'warning',
						text: i18n.ts._gomoku.gameCanceled,
					});
					router.push('/gomoku');
				}
			});
		}
	} catch (err: any) {
		if (err.code === 'NO_SUCH_GAME') {
			error.value = 'notFound';
		} else {
			error.value = 'error';
		}
	}
}

useInterval(async () => {
	if (game.value == null) return;
	if (game.value.isStarted) return;

	const _game = await misskeyApi('gomoku/show-game', {
		gameId: props.gameId,
	});

	if (_game.isStarted) {
		start(_game);
	} else {
		game.value = _game;
	}
}, 1000 * 10, {
	immediate: false,
	afterMounted: true,
});

onMounted(() => {
	fetchGame();
});

onUnmounted(() => {
	if (connection.value) {
		connection.value.dispose();
	}
});

definePage(() => ({
	title: i18n.ts._gomoku.title,
	icon: 'ti ti-circles',
}));
</script>

<style lang="scss" module>
.retryButton {
	margin: 0 auto;
}
</style>
