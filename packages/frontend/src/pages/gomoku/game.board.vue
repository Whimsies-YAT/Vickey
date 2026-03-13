<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 700px;">
	<div :class="$style.root" class="_gaps">
		<div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
			<span>({{ i18n.ts._gomoku.black }})</span>
			<MkAvatar style="width: 32px; height: 32px;" :user="blackUser" :showIndicator="true"/>
			<span> vs </span>
			<MkAvatar style="width: 32px; height: 32px;" :user="whiteUser" :showIndicator="true"/>
			<span>({{ i18n.ts._gomoku.white }})</span>
		</div>

		<div style="overflow: clip; line-height: 28px; text-align: center;">
			<div v-if="!iAmPlayer && !game.isEnded && currentPlayerIsBlack !== null && turnUser">
				<Mfm :key="'turn:' + turnUser.id" :text="i18n.tsx._gomoku.turnOf({ name: turnUser.name ?? turnUser.username })" :plain="true" :customEmojis="turnUser.emojis"/>
				<MkEllipsis/>
			</div>
			<div v-if="iAmPlayer && !game.isEnded && !isMyTurn">{{ i18n.ts._gomoku.opponentTurn }}<MkEllipsis/></div>
			<div v-if="iAmPlayer && !game.isEnded && isMyTurn"><span style="display: inline-block; font-weight: bold; animation: global-tada 1s linear infinite both;">{{ i18n.ts._gomoku.myTurn }}</span></div>
			<div v-if="game.isEnded">
				<template v-if="game.winner">
					<Mfm :key="'won'" :text="i18n.tsx._gomoku.won({ name: game.winner.name ?? game.winner.username })" :plain="true" :customEmojis="game.winner.emojis"/>
					<span v-if="game.surrenderedUserId != null"> ({{ i18n.ts._gomoku.surrendered }})</span>
				</template>
				<template v-else>{{ i18n.ts._gomoku.draw }}</template>
			</div>
		</div>

		<div :class="$style.boardContainer">
			<div :class="[$style.board, { [$style.boardDisabled]: game.isEnded || !iAmPlayer || !isMyTurn }]">
				<div
					v-for="(cell, index) in board"
					:key="index"
					:class="[$style.cell, { [$style.cellHover]: cell === EMPTY && !game.isEnded && iAmPlayer && isMyTurn }]"
					@click="putStone(index)"
				>
					<div v-if="cell === BLACK" :class="[$style.stone, $style.stoneBlack]"></div>
					<div v-else-if="cell === WHITE" :class="[$style.stone, $style.stoneWhite]"></div>
					<div v-if="lastMovePos === index" :class="$style.lastMoveMarker"></div>
				</div>
			</div>
		</div>

		<div class="_panel" style="padding: 16px;">
			<div>
				<b>{{ i18n.tsx._gomoku.turnCount({ count: moveCount }) }}</b>
			</div>
			<div style="margin-top: 8px;">
				<div style="display: flex; align-items: center;">
					<span style="margin-right: 8px;">({{ i18n.ts._gomoku.black }})</span>
					<MkAvatar style="width: 32px; height: 32px; margin-right: 8px;" :user="blackUser" :showIndicator="true"/>
					<MkA :to="userPage(blackUser)"><MkUserName :user="blackUser"/></MkA>
				</div>
				<div> vs </div>
				<div style="display: flex; align-items: center;">
					<span style="margin-right: 8px;">({{ i18n.ts._gomoku.white }})</span>
					<MkAvatar style="width: 32px; height: 32px; margin-right: 8px;" :user="whiteUser" :showIndicator="true"/>
					<MkA :to="userPage(whiteUser)"><MkUserName :user="whiteUser"/></MkA>
				</div>
			</div>
		</div>

		<div class="_buttonsCenter">
			<MkButton v-if="!game.isEnded && iAmPlayer" danger @click="surrender">{{ i18n.ts._gomoku.surrender }}</MkButton>
			<MkButton @click="share">{{ i18n.ts.share }}</MkButton>
		</div>

		<MkA v-if="game.isEnded" :to="`/gomoku`" style="display: block; text-align: center;">
			<i class="ti ti-circles" style="font-size: 64px; color: var(--MI_THEME-accent);"></i>
		</MkA>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import MkButton from '@/components/MkButton.vue';
import { deepClone } from '@/utility/clone.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { userPage } from '@/filters/user.js';
import * as os from '@/os.js';
import { uploadFile } from '@/utility/drive.js';

const $i = ensureSignin();

const props = defineProps<{
	game: Misskey.entities.GomokuGameDetailed;
	connection?: Misskey.IChannelConnection<Misskey.Channels['gomokuGame']> | null;
}>();

type GomokuConnection = Misskey.IChannelConnection<Misskey.Channels['gomokuGame']> & {
	send: (type: string, payload: Record<string, unknown>) => void;
};

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const BOARD_SIZE = 19;

const game = ref<Misskey.entities.GomokuGameDetailed>(deepClone(props.game));
const board = ref<number[]>([...game.value.board]);
const moveCount = computed(() => game.value.logs.length);
const lastMovePos = ref<number | null>(game.value.logs.length > 0 ? game.value.logs[game.value.logs.length - 1][0] : null);

const iAmPlayer = computed(() => {
	return game.value.user1Id === $i.id || game.value.user2Id === $i.id;
});

const blackUser = computed(() => {
	return game.value.black === 1 ? game.value.user1 : game.value.user2;
});

const whiteUser = computed(() => {
	return game.value.black === 1 ? game.value.user2 : game.value.user1;
});

const currentPlayerIsBlack = computed(() => {
	if (game.value.isEnded) return null;
	return moveCount.value % 2 === 0;
});

const turnUser = computed(() => {
	if (currentPlayerIsBlack.value === null) return null;
	return currentPlayerIsBlack.value ? blackUser.value : whiteUser.value;
});

const myColor = computed(() => {
	if (!iAmPlayer.value) return null;
	if (game.value.user1Id === $i.id) {
		return game.value.black === 1 ? BLACK : WHITE;
	} else {
		return game.value.black === 2 ? BLACK : WHITE;
	}
});

const isMyTurn = computed(() => {
	if (!iAmPlayer.value) return false;
	if (game.value.isEnded) return false;
	const myTurnIsBlack = myColor.value === BLACK;
	return currentPlayerIsBlack.value === myTurnIsBlack;
});

function putStone(pos: number) {
	if (game.value.isEnded) return;
	if (!iAmPlayer.value) return;
	if (!isMyTurn.value) return;
	if (board.value[pos] !== EMPTY) return;

	board.value[pos] = myColor.value!;
	lastMovePos.value = pos;

	const conn = props.connection as GomokuConnection | null;
	conn?.send('putStone', { pos });
}

function onStreamLog(log: [number, number]) {
	const [pos, player] = log;

	board.value[pos] = player;
	lastMovePos.value = pos;

	game.value.logs.push(log);
}

function onStreamEnded(x: { game: Misskey.entities.GomokuGameDetailed }) {
	game.value = deepClone(x.game);
	board.value = [...x.game.board];
}

async function surrender() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.areYouSure,
	});
	if (canceled) return;

	misskeyApi('gomoku/surrender', {
		gameId: game.value.id,
	});
}

function generateBoardImage(): Promise<Blob> {
	return new Promise((resolve) => {
		const CELL_SIZE = 30;
		const PADDING = 40;
		const BOARD_PIXEL_SIZE = BOARD_SIZE * CELL_SIZE;
		const CANVAS_SIZE = BOARD_PIXEL_SIZE + PADDING * 2;

		const canvas = window.document.createElement('canvas');
		canvas.width = CANVAS_SIZE;
		canvas.height = CANVAS_SIZE;
		const ctx = canvas.getContext('2d')!;

		const gradient = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
		gradient.addColorStop(0, '#d4a574');
		gradient.addColorStop(1, '#c9964f');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

		ctx.strokeStyle = '#8b6f47';
		ctx.lineWidth = 3;
		ctx.strokeRect(PADDING - 5, PADDING - 5, BOARD_PIXEL_SIZE + 10, BOARD_PIXEL_SIZE + 10);

		ctx.strokeStyle = '#8b6f47';
		ctx.lineWidth = 1;
		for (let i = 0; i < BOARD_SIZE; i++) {
			ctx.beginPath();
			ctx.moveTo(PADDING + i * CELL_SIZE, PADDING);
			ctx.lineTo(PADDING + i * CELL_SIZE, PADDING + BOARD_PIXEL_SIZE);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(PADDING, PADDING + i * CELL_SIZE);
			ctx.lineTo(PADDING + BOARD_PIXEL_SIZE, PADDING + i * CELL_SIZE);
			ctx.stroke();
		}

		const starPoints = [
			[3, 3], [3, 9], [3, 15],
			[9, 3], [9, 9], [9, 15],
			[15, 3], [15, 9], [15, 15],
		];
		ctx.fillStyle = '#8b6f47';
		for (const [row, col] of starPoints) {
			ctx.beginPath();
			ctx.arc(
				PADDING + col * CELL_SIZE,
				PADDING + row * CELL_SIZE,
				3,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}

		for (let i = 0; i < board.value.length; i++) {
			const stone = board.value[i];
			if (stone === EMPTY) continue;

			const row = Math.floor(i / BOARD_SIZE);
			const col = i % BOARD_SIZE;
			const x = PADDING + col * CELL_SIZE;
			const y = PADDING + row * CELL_SIZE;

			ctx.beginPath();
			ctx.arc(x + 2, y + 2, CELL_SIZE * 0.4, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
			ctx.fill();

			ctx.beginPath();
			ctx.arc(x, y, CELL_SIZE * 0.4, 0, Math.PI * 2);

			if (stone === BLACK) {
				const blackGradient = ctx.createRadialGradient(
					x - CELL_SIZE * 0.15, y - CELL_SIZE * 0.15, 0,
					x, y, CELL_SIZE * 0.4,
				);
				blackGradient.addColorStop(0, '#4a4a4a');
				blackGradient.addColorStop(1, '#000');
				ctx.fillStyle = blackGradient;
			} else {
				const whiteGradient = ctx.createRadialGradient(
					x - CELL_SIZE * 0.15, y - CELL_SIZE * 0.15, 0,
					x, y, CELL_SIZE * 0.4,
				);
				whiteGradient.addColorStop(0, '#fff');
				whiteGradient.addColorStop(1, '#e0e0e0');
				ctx.fillStyle = whiteGradient;
			}
			ctx.fill();

			ctx.strokeStyle = stone === BLACK ? '#000' : '#ccc';
			ctx.lineWidth = 1;
			ctx.stroke();

			if (i === lastMovePos.value) {
				ctx.beginPath();
				ctx.arc(x, y, CELL_SIZE * 0.12, 0, Math.PI * 2);
				ctx.fillStyle = '#ff6b6b';
				ctx.fill();
			}
		}

		canvas.toBlob((blob) => {
			resolve(blob!);
		}, 'image/png');
	});
}

async function share() {
	const winnerMention = game.value.winner ? `@${game.value.winner.username}` : '';
	const result = game.value.winner
		? i18n.ts._gomoku.won.replace('{name}', winnerMention)
		: i18n.ts._gomoku.draw;

	const boardImage = await generateBoardImage();
	const boardImageFile = new File([boardImage], 'gomoku-board.png', { type: 'image/png' });

	const { filePromise } = uploadFile(boardImageFile, {
		name: 'gomoku-board.png',
	});
	const file = await filePromise;

	os.post({
		initialText: `#VickeyGomoku\n${result}\n${url}/gomoku/g/${game.value.id}`,
		initialFiles: [file],
		instant: true,
	});
}

onMounted(() => {
	const conn = props.connection as any;
	if (conn) {
		conn.on('log', onStreamLog);
		conn.on('ended', onStreamEnded);
	}
});

onActivated(() => {
	const conn = props.connection as any;
	if (conn) {
		conn.on('log', onStreamLog);
		conn.on('ended', onStreamEnded);
	}
});

onDeactivated(() => {
	const conn = props.connection as any;
	if (conn) {
		conn.off('log', onStreamLog);
		conn.off('ended', onStreamEnded);
	}
});

onUnmounted(() => {
	const conn = props.connection as any;
	if (conn) {
		conn.off('log', onStreamLog);
		conn.off('ended', onStreamEnded);
	}
});
</script>

<style lang="scss" module>
.root {
	text-align: center;
}

.boardContainer {
	background: linear-gradient(135deg, #d4a574 0%, #c9964f 100%);
	padding: 20px;
	border-radius: 12px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	display: inline-block;
}

.board {
	display: grid;
	grid-template-columns: repeat(19, 1fr);
	gap: 0;
	background: #d4a574;
	border: 2px solid #8b6f47;
	width: fit-content;
	margin: 0 auto;
}

.boardDisabled {
	pointer-events: none;
	opacity: 0.6;

	.cell {
		cursor: not-allowed;
	}
}

.cell {
	width: 24px;
	height: 24px;
	background: linear-gradient(135deg, #d4a574 0%, #c9964f 100%);
	border: 1px solid #a0826d;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	position: relative;
	transition: background 0.2s;

	&::before,
	&::after {
		content: '';
		position: absolute;
		background: #8b6f47;
	}

	&::before {
		width: 1px;
		height: 100%;
	}

	&::after {
		height: 1px;
		width: 100%;
	}
}

.cellHover:hover {
	background: rgba(255, 255, 255, 0.2);
}

.stone {
	width: 20px;
	height: 20px;
	border-radius: 50%;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	z-index: 1;
	animation: placeStone 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes placeStone {
	0% {
		transform: scale(0);
	}
	100% {
		transform: scale(1);
	}
}

.stoneBlack {
	background: radial-gradient(circle at 30% 30%, #4a4a4a, #000);
	border: 1px solid #000;
}

.stoneWhite {
	background: radial-gradient(circle at 30% 30%, #fff, #e0e0e0);
	border: 1px solid #ccc;
}

.lastMoveMarker {
	position: absolute;
	width: 6px;
	height: 6px;
	background: var(--MI_THEME-accent);
	border-radius: 50%;
	z-index: 2;
	animation: pulse 1s infinite;
}

@keyframes pulse {
	0%, 100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.5;
		transform: scale(1.5);
	}
}

@container (max-width: 500px) {
	.cell {
		width: 18px;
		height: 18px;
	}

	.stone {
		width: 16px;
		height: 16px;
	}
}
</style>
