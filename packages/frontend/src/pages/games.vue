<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div class="_panel" :class="$style.link">
				<MkA to="/bubble-game">
					<img src="/client-assets/drop-and-fusion/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/reversi">
					<img src="/client-assets/reversi/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/conway-game-of-life">
					<div style="display: flex; align-items: center; justify-content: center; height: 200px; background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%); color: #4ade80; font-size: 24px; font-weight: bold; border-radius: 8px;">
						<div style="text-align: center;">
							<div style="font-size: 48px; margin-bottom: 8px;">⚫⚪</div>
							<div>{{ i18n.ts._conway.title }}</div>
							<div style="font-size: 14px; font-weight: normal; margin-top: 4px; opacity: 0.8;">{{ i18n.ts._conway.description }}</div>
						</div>
					</div>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/gomoku">
					<div style="display: flex; align-items: center; justify-content: center; height: 200px; background: linear-gradient(135deg, #d4a574 0%, #c9964f 100%); color: #3d2f1f; font-size: 24px; font-weight: bold; border-radius: 8px;">
						<div style="text-align: center;">
							<div style="font-size: 48px; margin-bottom: 8px;">⚫⚪</div>
							<div>{{ i18n.ts._gomoku.title }}</div>
							<div style="font-size: 14px; font-weight: normal; margin-top: 4px; opacity: 0.8;">{{ i18n.ts._gomoku.description }}</div>
						</div>
					</div>
				</MkA>
			</div>
<!--			<div class="_panel" :class="$style.link">-->
<!--				<MkA to="/werewolf">-->
<!--					<div style="display: flex; align-items: center; justify-content: center; height: 200px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e4b363; font-size: 24px; font-weight: bold; border-radius: 8px;">-->
<!--						<div style="text-align: center;">-->
<!--							<div style="font-size: 48px; margin-bottom: 8px;">🌙🐺</div>-->
<!--							<div>{{ i18n.ts._werewolf.title }}</div>-->
<!--							<div style="font-size: 14px; font-weight: normal; margin-top: 4px; opacity: 0.8;">{{ i18n.ts._werewolf.description }}</div>-->
<!--						</div>-->
<!--					</div>-->
<!--				</MkA>-->
<!--			</div>-->
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

definePage(() => ({
	title: 'Misskey Games',
	icon: 'ti ti-device-gamepad',
}));
</script>

<style module>
.link:focus-within {
	outline: 2px solid var(--MI_THEME-focus);
	outline-offset: -2px;
}
</style>
