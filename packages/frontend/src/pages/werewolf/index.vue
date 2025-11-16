<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 800px;">
	<div class="_gaps">
		<div style="text-align: center; padding: 16px 0;">
			<div style="font-size: 2.5em; font-weight: bold; margin-bottom: 8px;">
				<i class="ti ti-moon-stars"></i> {{ i18n.ts._werewolf.title }}
			</div>
		</div>

		<div class="_panel _gaps" style="padding: 16px;">
			<div class="_buttonsCenter">
				<MkButton primary gradate rounded @click="createGame('preset_6')">{{ i18n.ts._werewolf.create6PlayerGame }}</MkButton>
				<MkButton primary gradate rounded @click="createGame('preset_9')">{{ i18n.ts._werewolf.create9PlayerGame }}</MkButton>
			</div>
		</div>

		<MkFolder v-if="$i" :defaultOpen="true">
			<template #label>{{ i18n.ts._werewolf.myGames }}</template>
			<MkPagination :paginator="myGamesPaginator">
				<template #default="{ items }">
					<div :class="$style.gamePreviews">
						<MkA v-for="g in items" :key="g.id" v-panel :class="[$style.gamePreview, g.phase === 'waiting' && $style.gamePreviewWaiting, g.phase !== 'waiting' && g.phase !== 'ended' && $style.gamePreviewActive]" tabindex="-1" :to="`/werewolf/g/${g.id}`">
							<div :class="$style.gamePreviewContent">
								<div :class="$style.gamePreviewHeader">
									<span :class="$style.gamePreviewMode">
										{{ g.mode === 'preset_6' ? i18n.ts._werewolf.sixPlayer : i18n.ts._werewolf.ninePlayer }}
									</span>
									<span :class="$style.gamePreviewPlayers">
										<i class="ti ti-users"></i> {{ getPlayerCount(g) }}/{{ g.mode === 'preset_6' ? 6 : 9 }}
									</span>
								</div>
								<div :class="$style.gamePreviewHost">
									<i class="ti ti-crown"></i> <MkUserName :user="g.host"/>
								</div>
							</div>
							<div :class="$style.gamePreviewFooter">
								<span v-if="g.phase === 'waiting'" :class="$style.gamePreviewStatusWaiting">{{ i18n.ts._werewolf.waiting }}</span>
								<span v-else-if="g.phase === 'ended'" :class="$style.gamePreviewStatusEnded">{{ i18n.ts._werewolf.ended }}</span>
								<span v-else :class="$style.gamePreviewStatusActive">{{ i18n.ts._werewolf.playing }}</span>
								<MkTime style="margin-left: auto; opacity: 0.7;" :time="g.createdAt"/>
							</div>
						</MkA>
					</div>
				</template>
			</MkPagination>
		</MkFolder>

		<MkFolder :defaultOpen="true">
			<template #label>{{ i18n.ts._werewolf.allGames }}</template>
			<MkPagination :paginator="gamesPaginator">
				<template #default="{ items }">
					<div :class="$style.gamePreviews">
						<MkA v-for="g in items" :key="g.id" v-panel :class="[$style.gamePreview, g.phase === 'waiting' && $style.gamePreviewWaiting, g.phase !== 'waiting' && g.phase !== 'ended' && $style.gamePreviewActive]" tabindex="-1" :to="`/werewolf/g/${g.id}`">
							<div :class="$style.gamePreviewContent">
								<div :class="$style.gamePreviewHeader">
									<span :class="$style.gamePreviewMode">
										{{ g.mode === 'preset_6' ? i18n.ts._werewolf.sixPlayer : i18n.ts._werewolf.ninePlayer }}
									</span>
									<span :class="$style.gamePreviewPlayers">
										<i class="ti ti-users"></i> {{ getPlayerCount(g) }}/{{ g.mode === 'preset_6' ? 6 : 9 }}
									</span>
								</div>
								<div :class="$style.gamePreviewHost">
									<i class="ti ti-crown"></i> <MkUserName :user="g.host"/>
								</div>
							</div>
							<div :class="$style.gamePreviewFooter">
								<span v-if="g.phase === 'waiting'" :class="$style.gamePreviewStatusWaiting">{{ i18n.ts._werewolf.waiting }}</span>
								<span v-else-if="g.phase === 'ended'" :class="$style.gamePreviewStatusEnded">{{ i18n.ts._werewolf.ended }}</span>
								<span v-else :class="$style.gamePreviewStatusActive">{{ i18n.ts._werewolf.playing }}</span>
								<MkTime style="margin-left: auto; opacity: 0.7;" :time="g.createdAt"/>
							</div>
						</MkA>
					</div>
				</template>
			</MkPagination>
		</MkFolder>
	</div>
</div>
</template>

<script lang="ts" setup>
import { markRaw, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import MkPagination from '@/components/MkPagination.vue';
import { useRouter } from '@/router.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { Paginator } from '@/utility/paginator.js';
import * as os from '@/os.js';
import * as Misskey from 'misskey-js';
import { useStream } from '@/stream.js';

const myGamesPaginator = markRaw(new Paginator('werewolf/games', {
	limit: 10,
	params: {
		my: true,
	},
}));

const gamesPaginator = markRaw(new Paginator('werewolf/games', {
	limit: 10,
}));

const router = useRouter();
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['werewolf']> | null>(null);

onMounted(() => {
	if (!$i) return;

	connection.value = useStream().useChannel('werewolf');

	connection.value.on('matched', (data) => {
		myGamesPaginator.reload();
		gamesPaginator.reload();
	});

	connection.value.on('canceled', (data) => {
		myGamesPaginator.reload();
		gamesPaginator.reload();
	});
});

onBeforeUnmount(() => {
	if (connection.value) {
		connection.value.dispose();
		connection.value = null;
	}
});

function getPlayerCount(game: any): number {
	if (game.phase === 'waiting') {
		return game.seats?.filter((s: any) => s.userId !== null).length ?? 0;
	}
	return game.players?.length ?? 0;
}

function getGameModeConfig(mode: 'preset_6' | 'preset_9') {
	if (mode === 'preset_6') {
		return {
			title: i18n.ts._werewolf.create6PlayerGame,
			roles: [
				{ name: i18n.ts._werewolf.seer, count: 1 },
				{ name: i18n.ts._werewolf.witch, count: 1 },
				{ name: i18n.ts._werewolf.villager, count: 2 },
				{ name: i18n.ts._werewolf.werewolf, count: 2 },
			],
			totalPlayers: 6,
		};
	} else {
		return {
			title: i18n.ts._werewolf.create9PlayerGame,
			roles: [
				{ name: i18n.ts._werewolf.seer, count: 1 },
				{ name: i18n.ts._werewolf.witch, count: 1 },
				{ name: i18n.ts._werewolf.hunter, count: 1 },
				{ name: i18n.ts._werewolf.villager, count: 3 },
				{ name: i18n.ts._werewolf.werewolf, count: 3 },
			],
			totalPlayers: 9,
		};
	}
}

async function createGame(mode: 'preset_6' | 'preset_9') {
	pleaseLogin();

	const config = getGameModeConfig(mode);
	const rolesText = config.roles.map(r => `${r.name} × ${r.count}`).join('\n');

	const confirmed = await os.confirm({
		type: 'info',
		title: config.title,
		text: `${i18n.ts._werewolf.roleDistribution}:\n${rolesText}\n\n${i18n.ts._werewolf.gameRules}:\n• ${i18n.ts._werewolf.closedRole}\n• ${i18n.ts._werewolf.slaughterAllSides}\n  ${i18n.ts._werewolf.slaughterAllSidesDesc}`,
	});

	if (!confirmed.canceled) {
		const game = await misskeyApi('werewolf/create', {
			mode,
		}) as Misskey.entities.WerewolfGameDetailed;

		if (game) {
			router.push({
				path: `/werewolf/g/${game.id}`,
			} as any);
		}
	}
}

definePage(() => ({
	title: i18n.ts._werewolf.title,
	icon: 'ti ti-moon-stars',
}));
</script>

<style lang="scss" module>
@keyframes blink {
	0% { opacity: 1; }
	50% { opacity: 0.2; }
}

.gamePreviews {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	grid-gap: var(--MI-margin);
}

.gamePreview {
	font-size: 90%;
	border-radius: 8px;
	overflow: clip;
}

.gamePreviewActive {
	box-shadow: inset 0 0 8px 0px var(--MI_THEME-accent);
}

.gamePreviewWaiting {
	box-shadow: inset 0 0 8px 0px var(--MI_THEME-warn);
}

.gamePreviewContent {
	padding: 16px;
}

.gamePreviewHeader {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 8px;
}

.gamePreviewMode {
	font-weight: bold;
	font-size: 1.1em;
}

.gamePreviewPlayers {
	opacity: 0.7;
}

.gamePreviewHost {
	font-size: 0.95em;
	opacity: 0.8;
}

.gamePreviewFooter {
	display: flex;
	align-items: baseline;
	border-top: solid 0.5px var(--MI_THEME-divider);
	padding: 6px 10px;
	font-size: 0.9em;
}

.gamePreviewStatusActive {
	color: var(--MI_THEME-accent);
	font-weight: bold;
	animation: blink 2s infinite;
}

.gamePreviewStatusWaiting {
	color: var(--MI_THEME-warn);
	font-weight: bold;
	animation: blink 2s infinite;
}

.gamePreviewStatusEnded {
	opacity: 0.6;
}
</style>
