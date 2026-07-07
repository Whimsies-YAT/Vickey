<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div style="overflow: clip;">
		<div class="_spacer" style="--MI_SPACER-w: 600px; --MI_SPACER-min: 20px;">
			<div class="_gaps_m znqjceqz">
				<MkInfo warn>{{ i18n.ts.pageDeprecated }}</MkInfo>
				<FormLink to="/about-vickey">
					<template #icon><i class="ti ti-info-circle"></i></template>
					{{ i18n.ts.aboutVickey }}
				</FormLink>
				<div v-panel class="about">
					<div ref="containerEl" class="container" :class="{ playing: easterEggEngine != null }">
						<img src="/client-assets/about-icon.png" alt="" class="icon" draggable="false" @load="iconLoaded" @click="gravity"/>
						<div class="misskey">Misskey</div>
						<div class="version">v{{ version }}</div>
						<span v-for="emoji in easterEggEmojis" :key="emoji.id" class="emoji" :data-physics-x="emoji.left" :data-physics-y="emoji.top" :class="{ _physics_circle_: !emoji.emoji.startsWith(':') }">
							<MkCustomEmoji v-if="emoji.emoji[0] === ':'" class="emoji" :name="emoji.emoji" :normal="true" :noStyle="true" :fallbackToImage="true"/>
							<MkEmoji v-else class="emoji unicode" :emoji="emoji.emoji" :normal="true" :noStyle="true"/>
						</span>
					</div>
					<button v-if="thereIsTreasure" class="_button treasure" @click="getTreasure"><img src="/fluent-emoji/1f3c6.png" class="treasureImg"></button>
				</div>
				<div style="text-align: center;">
					{{ i18n.ts._aboutMisskey.about }}<br><a href="https://misskey-hub.net/docs/about-misskey/" target="_blank" class="_link">{{ i18n.ts.learnMore }}</a>
				</div>
				<div style="text-align: center;">
					{{ i18n.ts._aboutVickey.about }}
				</div>
				<div v-if="$i != null" style="text-align: center;">
					<MkButton primary rounded inline @click="iLoveMisskey">I <Mfm text="$[jelly ❤]"/> #Misskey</MkButton>
				</div>
				<FormSection>
					<div class="_gaps_s">
						<FormLink to="https://github.com/misskey-dev/misskey" external>
							<template #icon><i class="ti ti-code"></i></template>
							{{ i18n.ts._aboutMisskey.source }} (Misskey)
							<template #suffix>GitHub</template>
						</FormLink>
						<FormLink to="https://github.com/Whimsies-YAT/Vickey" external>
							<template #icon><i class="ti ti-code"></i></template>
							{{ i18n.ts._aboutVickey.source }} ({{ i18n.ts._aboutVickey.original }})
							<template #suffix>GitHub</template>
						</FormLink>
						<FormLink to="https://crowdin.com/project/misskey" external>
							<template #icon><i class="ti ti-language-hiragana"></i></template>
							{{ i18n.ts._aboutMisskey.translation }}
							<template #suffix>Crowdin</template>
						</FormLink>
						<FormLink to="https://crowdin.com/project/vickey" external>
							<template #icon><i class="ti ti-language-hiragana"></i></template>
							{{ i18n.ts._aboutVickey.translation }}
							<template #suffix>Crowdin</template>
						</FormLink>
						<FormLink to="https://www.patreon.com/syuilo" external>
							<template #icon><i class="ti ti-pig-money"></i></template>
							{{ i18n.ts._aboutMisskey.donate }}
							<template #suffix>Patreon</template>
						</FormLink>
						<FormLink to="https://www.patreon.com/yateam" external>
							<template #icon><i class="ti ti-pig-money"></i></template>
							{{ i18n.ts._aboutVickey.donate }}
							<template #suffix>Vickey Patreon</template>
						</FormLink>
					</div>
				</FormSection>
				<FormSection v-if="repositoryUrlLC !== 'https://github.com/whimsies-yat/vickey'">
					<div class="_gaps_s">
						<MkInfo>
							{{ i18n.tsx._aboutVickey.thisIsModifiedVersionVK({ name: instance.name ?? host }) }}
						</MkInfo>
						<FormLink v-if="instance.repositoryUrl" :to="instance.repositoryUrl" external>
							<template #icon><i class="ti ti-code"></i></template>
							{{ i18n.ts._aboutVickey.source }}
						</FormLink>
						<FormLink v-if="instance.providesTarball" :to="`/tarball/vickey-${version}.tar.gz`" external>
							<template #icon><i class="ti ti-download"></i></template>
							{{ i18n.ts._aboutVickey.source }}
							<template #suffix>Tarball</template>
						</FormLink>
						<MkInfo v-if="!instance.repositoryUrl && !instance.providesTarball" warn>
							{{ i18n.ts.sourceCodeIsNotYetProvided }}
						</MkInfo>
					</div>
				</FormSection>
				<FormSection>
					<template #label>{{ i18n.ts._aboutMisskey.projectMembers }} (Misskey)</template>
					<div :class="$style.contributors">
						<a href="https://github.com/syuilo" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/4439005?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@syuilo</span>
						</a>
						<a href="https://github.com/acid-chicken" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/20679825?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@acid-chicken</span>
						</a>
						<a href="https://github.com/kakkokari-gtyih" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/67428053?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@kakkokari-gtyih</span>
						</a>
						<a href="https://github.com/tai-cha" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/40626578?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@tai-cha</span>
						</a>
						<a href="https://github.com/samunohito" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/46447427?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@samunohito</span>
						</a>
						<a href="https://github.com/anatawa12" target="_blank" :class="$style.contributor">
							<img src="https://avatars.githubusercontent.com/u/22656849?v=4" :class="$style.contributorAvatar">
							<span :class="$style.contributorUsername">@anatawa12</span>
						</a>
					</div>
				</FormSection>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { nextTick, onBeforeUnmount, ref, useTemplateRef, computed } from 'vue';
import { host, version } from '@@/js/config.js';
import { DEFAULT_EMOJIS } from '@@/js/const.js';
import FormLink from '@/components/form/link.vue';
import FormSection from '@/components/form/section.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { physics } from '@/utility/physics.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import { claimAchievement, claimedAchievements } from '@/utility/achievements.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';

const thereIsTreasure = ref($i && !claimedAchievements.includes('foundTreasure'));
const repositoryUrlLC = computed(() => {
	return typeof instance.repositoryUrl === 'string' ? instance.repositoryUrl.toLowerCase() : '';
});

let easterEggReady = false;
const easterEggEmojis = ref<{
	id: string,
	top: number,
	left: number,
	emoji: string
}[]>([]);
const easterEggEngine = ref<{ stop: () => void } | null>(null);
const containerEl = useTemplateRef('containerEl');

function iconLoaded() {
	if (containerEl.value == null) return;
	const emojis = prefer.s.emojiPalettes[0]?.emojis ?? [];

	if (emojis.length < DEFAULT_EMOJIS.length) {
		emojis.push(...DEFAULT_EMOJIS.slice(0, DEFAULT_EMOJIS.length - emojis.length));
	}

	const containerWidth = containerEl.value.offsetWidth;
	for (let i = 0; i < 32; i++) {
		easterEggEmojis.value.push({
			id: i.toString(),
			top: -(128 + (Math.random() * 256)),
			left: (Math.random() * containerWidth),
			emoji: emojis[Math.floor(Math.random() * emojis.length)],
		});
	}

	nextTick(() => {
		easterEggReady = true;
	});
}

function gravity() {
	if (containerEl.value == null) return;
	if (!easterEggReady) return;
	easterEggReady = false;
	easterEggEngine.value = physics(containerEl.value);
}

function iLoveMisskey() {
	os.post({
		initialText: 'I $[jelly ❤] #Misskey',
		instant: true,
	});
}

function getTreasure() {
	thereIsTreasure.value = false;
	claimAchievement('foundTreasure');
}

onBeforeUnmount(() => {
	if (easterEggEngine.value) {
		easterEggEngine.value.stop();
	}
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.aboutMisskey,
	icon: null,
}));
</script>

<style lang="scss" scoped>
.znqjceqz {
	> .about {
		position: relative;
		border-radius: var(--MI-radius);

		> .treasure {
			position: absolute;
			top: 60px;
			left: 0;
			right: 0;
			margin: 0 auto;
			width: min-content;

			> .treasureImg {
				width: 25px;
				vertical-align: bottom;
			}
		}

		> .container {
			position: relative;
			text-align: center;
			padding: 16px;

			&.playing {
				&, * {
					user-select: none;
				}

				* {
					will-change: transform;
				}

				> .emoji {
					visibility: visible;
				}
			}

			> .icon {
				display: block;
				width: 80px;
				margin: 0 auto;
				border-radius: 16px;
				position: relative;
				z-index: 1;
			}

			> .misskey {
				margin: 0.75em auto 0 auto;
				width: max-content;
				position: relative;
				z-index: 1;
			}

			> .version {
				margin: 0 auto;
				width: max-content;
				opacity: 0.5;
				position: relative;
				z-index: 1;
			}

			> .emoji {
				position: absolute;
				z-index: 1;
				top: 0;
				left: 0;
				visibility: hidden;

				> .emoji {
					pointer-events: none;
					font-size: 24px;
					width: 24px;

					&.unicode {
						height: 24px;
					}
				}
			}
		}
	}
}
</style>

<style lang="scss" module>
.contributors {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	grid-gap: 12px;
}

.contributor {
	display: flex;
	align-items: center;
	padding: 12px;
	background: var(--MI_THEME-buttonBg);
	border-radius: 6px;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.active {
		color: var(--MI_THEME-accent);
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.contributorAvatar {
	width: 30px;
	border-radius: 100%;
}

.contributorUsername {
	margin-left: 12px;
}
</style>
