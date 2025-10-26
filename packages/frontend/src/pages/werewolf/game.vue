<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="game == null || (!game.isEnded && connection == null)"><MkLoading/></div>
<div v-else-if="game.phase === 'waiting'" class="_spacer" style="--MI_SPACER-w: 800px;">
	<div class="_gaps">
		<div class="_panel" style="padding: 16px;">
			<div style="text-align: center; margin-bottom: 16px;">
				<h2 style="margin: 0;">
					<i class="ti ti-moon-stars"></i> {{ i18n.ts._werewolf.title }}
				</h2>
				<div style="opacity: 0.7; margin-top: 8px;">
					{{ game.config.maxPlayers }} {{ i18n.ts._werewolf.players }} - {{ i18n.ts._werewolf.waitingForPlayers }}
				</div>
				<div style="margin-top: 8px; font-size: 0.9em;">
					{{ occupiedSeats.length }}/{{ game.config.maxPlayers }} {{ i18n.ts._werewolf.seated }}
				</div>
			</div>

			<div class="seat-circle-container">
				<div v-for="seatNum in Array.from({ length: game.config.maxPlayers }, (_, i) => i)" :key="seatNum"
					class="_panel seat-circle"
					:class="{
						'_button': canTakeSeat(seatNum),
						'seat-circle--locked': getSeatByNumber(seatNum)?.locked,
						'seat-circle--selected': mySeat === seatNum,
						'seat-circle--clickable': canTakeSeat(seatNum)
					}"
					:style="getSeatPosition(seatNum, game.config.maxPlayers)"
					@click="handleSeatClick(seatNum)">
					<div class="seat-number-badge">{{ seatNum + 1 }}</div>
					<template v-if="getSeatByNumber(seatNum)?.userId">
						<div class="seat-avatar-wrapper">
							<MkAvatar :user="getUserBySeat(seatNum)" class="seat-avatar-circle"/>
							<span v-if="getSeatByNumber(seatNum)?.userId === game.hostId" class="seat-role-marker seat-role-marker--host">
								<i class="ti ti-crown"></i>
							</span>
							<span v-if="game.readyPlayers?.includes(getSeatByNumber(seatNum)?.userId)" class="seat-role-marker seat-role-marker--ready">
								<i class="ti ti-check"></i>
							</span>
						</div>
						<div class="seat-username">
							<MkUserName :user="getUserBySeat(seatNum)"/>
						</div>
					</template>
					<template v-else-if="getSeatByNumber(seatNum)?.locked">
						<div class="seat-avatar-placeholder seat-avatar-placeholder--locked">
							<i class="ti ti-lock"></i>
						</div>
						<div class="seat-username seat-username--empty">
							{{ i18n.ts._werewolf.seatLocked }}
						</div>
					</template>
					<template v-else>
						<div class="seat-avatar-placeholder">
							<i class="ti ti-user-plus"></i>
						</div>
						<div class="seat-username seat-username--empty">
							{{ i18n.ts._werewolf.emptySeat }}
						</div>
					</template>
				</div>
			</div>

			<div v-if="mySeat !== null" class="_buttonsCenter" style="margin-top: 16px;">
				<MkButton v-if="!isReady" primary :disabled="isTogglingReady" @click="toggleReady">
					<i class="ti ti-check"></i> {{ i18n.ts._werewolf.ready }}
				</MkButton>
				<MkButton v-else :disabled="isTogglingReady" @click="toggleReady">
					<i class="ti ti-x"></i> {{ i18n.ts._werewolf.unready }}
				</MkButton>
				<MkButton @click="leaveSeat">
					<i class="ti ti-logout"></i> {{ i18n.ts._werewolf.leaveSeat }}
				</MkButton>
			</div>
			<div v-else class="_buttonsCenter" style="margin-top: 16px;">
				<div style="text-align: center; opacity: 0.7;">
					{{ i18n.ts._werewolf.selectSeat }}
				</div>
			</div>

			<div v-if="countdown !== null" style="margin-top: 16px; text-align: center;">
				<div class="countdown-display">
					<i class="ti ti-clock"></i>
					{{ countdown }}
				</div>
			</div>

			<div style="margin-top: 16px; padding: 12px; text-align: center; font-size: 0.9em;">
				<div style="opacity: 0.7; margin-bottom: 4px;">
					{{ game.readyPlayers?.length ?? 0 }}/{{ occupiedSeats.length }} Ready
				</div>
			</div>
		</div>

		<div v-if="mySeat !== null && game.config.voiceEnabled" class="_panel" style="padding: 16px; margin-top: 16px;">
			<div style="font-weight: bold; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
				<div style="display: flex; align-items: center;">
					<i class="ti ti-headphones" style="margin-right: 8px;"></i>
					Voice Chat
				</div>
				<MkButton v-if="voiceConnected" @click="toggleMute" :primary="!localMuted" style="font-size: 0.9em;">
					<i :class="localMuted ? 'ti ti-microphone-off' : 'ti ti-microphone'"></i>
					{{ localMuted ? i18n.ts._werewolf.unmute : i18n.ts._werewolf.mute }}
				</MkButton>
			</div>

			<div v-if="!voiceConnected" style="text-align: center; padding: 20px; opacity: 0.7;">
				<i class="ti ti-loader" style="font-size: 2em; margin-bottom: 8px;"></i>
				<div>Connecting to voice...</div>
			</div>
			<div v-else style="text-align: center; padding: 12px; background: var(--MI_THEME-accentedBg); border-radius: 8px;">
				<i class="ti ti-circle-check" style="color: var(--MI_THEME-accent); margin-right: 8px;"></i>
				<span style="color: var(--MI_THEME-accent); font-weight: bold;">Voice Connected</span>
				<div v-if="!localMuted" style="margin-top: 8px; font-size: 0.9em; opacity: 0.8;">
					<i class="ti ti-microphone" style="margin-right: 4px;"></i>
					Your microphone is on
				</div>
			</div>
		</div>

	</div>

	<div v-if="mySeat !== null && game.phase !== 'ended'" class="_panel" style="padding: 16px; margin-top: 16px;">
		<div style="font-weight: bold; margin-bottom: 12px; display: flex; align-items: center;">
			<i class="ti ti-message-2" style="margin-right: 8px;"></i>
			{{ currentChatTitle }}
		</div>

		<div class="chat-messages" style="height: 200px; overflow-y: auto; margin-bottom: 12px; padding: 8px; background: var(--MI_THEME-panel); border-radius: 8px;">
			<div v-if="visibleMessages.length === 0" style="text-align: center; opacity: 0.5; padding: 20px;">
				{{ i18n.ts._werewolf.noMessagesYet }}
			</div>
			<div v-for="(msg, index) in visibleMessages" :key="index" style="margin-bottom: 8px; padding: 8px; background: var(--MI_THEME-panelHighlight); border-radius: 6px;">
				<div style="display: flex; align-items: center; margin-bottom: 4px;">
					<MkAvatar :user="getUserById(msg.userId)" style="width: 24px; height: 24px; margin-right: 8px;"/>
					<MkUserName :user="getUserById(msg.userId)" style="font-weight: bold; font-size: 0.9em;"/>
				</div>
				<div style="margin-left: 32px; word-break: break-word;">
					{{ msg.message }}
				</div>
			</div>
		</div>

		<div v-if="canSendMessage" style="display: flex; gap: 8px;">
			<input
				v-model="chatInput"
				type="text"
				:placeholder="i18n.ts._werewolf.typeMessage"
				class="chat-input"
				style="flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); color: var(--MI_THEME-fg);"
				@keydown.enter="sendChatMessage"
			/>
			<MkButton primary :disabled="!chatInput.trim()" @click="sendChatMessage">
				<i class="ti ti-send"></i>
			</MkButton>
		</div>
		<div v-else style="text-align: center; opacity: 0.5; padding: 8px; font-size: 0.9em;">
			{{ i18n.ts._werewolf.cannotSendMessage }}
		</div>
	</div>
</div>
<div v-else-if="game.phase === 'ended'" class="_spacer" style="--MI_SPACER-w: 800px;">
	<div class="_gaps">
		<div class="_panel" style="padding: 16px; text-align: center;">
			<h2 style="margin: 0 0 16px 0;">{{ i18n.ts._werewolf.gameEnded }}</h2>
			<div style="font-size: 1.2em; margin: 16px 0;">
				{{ i18n.ts._werewolf.winner }}: {{ game.winnerTeam === 'werewolf' ? i18n.ts._werewolf.werewolves : i18n.ts._werewolf.villagers }}
			</div>
			<div class="_buttonsCenter" style="margin-top: 24px;">
				<MkButton inline @click="backToLobby">{{ i18n.ts._werewolf.backToLobby }}</MkButton>
			</div>
		</div>

		<div v-if="gameHistory" class="_panel" style="padding: 16px;">
			<h3 style="margin: 0 0 16px 0;">{{ i18n.ts._werewolf.gameHistory }}</h3>

			<div class="game-history-section">
				<h4>{{ i18n.ts._werewolf.playerRoles }}</h4>
				<div class="players-grid">
					<div v-for="player in gameHistory.players" :key="player.userId" class="player-role-item">
						<div class="player-role-name">{{ getPlayerName(player.userId) }}</div>
						<div class="player-role-badge" :class="`role-${player.role}`">
							{{ getRoleText(player.role) }}
						</div>
						<div class="player-role-status">
							{{ player.isAlive ? i18n.ts._werewolf.alive : i18n.ts._werewolf.dead }}
						</div>
					</div>
				</div>
			</div>

			<div class="game-history-section">
				<h4>{{ i18n.ts._werewolf.dayByDayHistory }}</h4>
				<div v-for="day in groupedLogs" :key="day.day" class="day-history">
					<div class="day-header">
						{{ i18n.ts._werewolf.day }} {{ day.day }}
					</div>
					<div class="day-events">
						<div v-for="(event, idx) in day.events" :key="idx" class="event-item">
							<div class="event-phase">{{ getPhaseText(event.phase) }}</div>
							<div class="event-description">{{ formatEventDescription(event) }}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<div v-else class="_panel" style="padding: 16px; text-align: center; opacity: 0.7;">
			<MkLoading/>
			<div style="margin-top: 8px;">{{ i18n.ts._werewolf.loadingHistory }}</div>
		</div>
	</div>
</div>
<div v-else class="_spacer" style="--MI_SPACER-w: 800px;">
	<div class="_gaps">
		<div class="_panel" style="padding: 16px;">
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
				<h3 style="margin: 0;">
					{{ i18n.ts._werewolf.phase }}: {{ getPhaseText(game.phase, game.subPhase) }}
				</h3>
				<div style="display: flex; gap: 12px; align-items: center;">
					<MkButton v-if="voiceConnected" @click="toggleMute" :primary="!localMuted">
						<i :class="localMuted ? 'ti ti-microphone-off' : 'ti ti-microphone'"></i>
						{{ localMuted ? i18n.ts._werewolf.unmute : i18n.ts._werewolf.mute }}
					</MkButton>
					<span style="font-size: 0.9em; opacity: 0.7;">
						{{ i18n.ts._werewolf.day }} {{ game.dayNumber }}
					</span>
				</div>
			</div>

			<div v-if="myRole" style="padding: 12px; background: var(--MI_THEME-panelHighlight); border-radius: 8px; margin-bottom: 16px;">
				<div style="font-weight: bold; margin-bottom: 4px;">
					{{ i18n.ts._werewolf.yourRole }}: {{ getRoleText(myRole) }}
				</div>
				<div style="font-size: 0.9em; opacity: 0.7;">
					{{ getRoleDescription(myRole) }}
				</div>
			</div>

			<div v-if="currentSpeaker" style="padding: 12px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border-radius: 8px; margin-bottom: 16px;">
				<div style="font-weight: bold; display: flex; align-items: center;">
					<i class="ti ti-microphone" style="margin-right: 8px;"></i>
					{{ currentSpeakerUser ? `${currentSpeakerUser.name || currentSpeakerUser.username}` : '' }}
					{{ isTestamentPhase ? i18n.ts._werewolf.givingTestament : i18n.ts._werewolf.speaking }}
				</div>
			</div>

			<div v-if="canSkipSpeech" class="_buttonsCenter" style="margin-bottom: 16px;">
				<MkButton primary @click="skipSpeech">
					<i class="ti ti-player-skip-forward"></i>
					{{ isTestamentPhase ? i18n.ts._werewolf.finishTestament : i18n.ts._werewolf.skipSpeech }}
				</MkButton>
			</div>

			<div v-if="game.phase === 'night' && myPlayer?.isAlive && canDoNightAction" class="_panel" style="padding: 16px; margin-bottom: 16px; background: var(--MI_THEME-panelHighlight);">
				<div style="font-weight: bold; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
					<span><i class="ti ti-moon"></i> {{ i18n.ts._werewolf.yourAction }}</span>
					<div v-if="nightPhaseTimeRemaining !== null" class="night-timer">
						<i class="ti ti-clock"></i>
						<span style="font-weight: bold; margin-left: 4px;">{{ nightPhaseTimeRemaining }}s</span>
						<span style="opacity: 0.7; margin-left: 2px;">/ {{ nightPhaseTotalTime }}s</span>
					</div>
				</div>

				<div v-if="myRole === 'werewolf' && game.subPhase === 'werewolf_turn'" class="_gaps_s">
					<div style="margin-bottom: 8px;">{{ i18n.ts._werewolf.selectKillTarget }}</div>
					<div v-for="player in selectablePlayers" :key="player.userId"
						class="_button"
						style="padding: 12px; display: flex; align-items: center; cursor: pointer;"
						:style="{ background: selectedTarget === player.userId ? 'var(--MI_THEME-accent)' : '' }"
						@click="selectTarget(player.userId)">
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
					</div>
					<MkButton v-if="selectedTarget" primary @click="submitAction('kill', selectedTarget)">
						{{ i18n.ts._werewolf.confirm }}
					</MkButton>
				</div>

				<div v-else-if="myRole === 'seer' && game.subPhase === 'seer_turn'" class="_gaps_s">
					<div style="margin-bottom: 8px;">{{ i18n.ts._werewolf.selectCheckTarget }}</div>
					<div v-for="player in selectablePlayers" :key="player.userId"
						class="_button"
						style="padding: 12px; display: flex; align-items: center; cursor: pointer;"
						:style="{ background: selectedTarget === player.userId ? 'var(--MI_THEME-accent)' : '' }"
						@click="selectTarget(player.userId)">
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
					</div>
					<MkButton v-if="selectedTarget" primary @click="submitAction('check', selectedTarget)">
						{{ i18n.ts._werewolf.confirm }}
					</MkButton>
				</div>

				<div v-else-if="myRole === 'witch' && game.subPhase === 'witch_turn'" class="_gaps_s">
					<div v-if="witchCurrentWindow === null" class="witch-time-window" style="padding: 12px; background: var(--MI_THEME-panel); border-radius: 8px; margin-bottom: 12px; text-align: center;">
						<i class="ti ti-loader"></i> {{ i18n.ts._werewolf.preparing }}
					</div>

					<div v-else-if="witchCurrentWindow === 'heal_window'" class="witch-time-window" style="padding: 12px; background: var(--MI_THEME-accentedBg); border-radius: 8px; margin-bottom: 12px;">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
							<div style="font-weight: bold; color: var(--MI_THEME-accent);">
								<i class="ti ti-heart"></i> {{ i18n.ts._werewolf.witchHealPhase }}
							</div>
							<div style="font-size: 0.9em; opacity: 0.8;">
								{{ witchWindowRemaining }}{{ i18n.ts._werewolf.secondsRemaining }}
							</div>
						</div>
						<MkButton v-if="witchCanHeal && witchUiState.nightKillTarget" primary @click="submitAction('heal')" style="width: 100%;">
							<i class="ti ti-heart"></i> {{ i18n.ts._werewolf.useHeal }}
						</MkButton>
						<div v-else-if="!witchUiState.hasAntidote" style="text-align: center; opacity: 0.6; padding: 8px;">
							{{ i18n.ts._werewolf.antidoteUsed }}
						</div>
						<div v-else-if="!witchUiState.nightKillTarget" style="text-align: center; opacity: 0.6; padding: 8px;">
							{{ i18n.ts._werewolf.noKillTonight }}
						</div>
					</div>

					<div v-else-if="witchCurrentWindow === 'transition'" class="witch-time-window" style="padding: 12px; background: var(--MI_THEME-panel); border-radius: 8px; margin-bottom: 12px; text-align: center; opacity: 0.7;">
						<i class="ti ti-loader"></i> {{ i18n.ts._werewolf.preparing }}
					</div>

					<div v-else-if="witchCurrentWindow === 'poison_window'" class="witch-time-window" style="padding: 12px; background: var(--MI_THEME-accentedBg); border-radius: 8px; margin-bottom: 12px;">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
							<div style="font-weight: bold; color: var(--MI_THEME-accent);">
								<i class="ti ti-poison"></i> {{ i18n.ts._werewolf.witchPoisonPhase }}
							</div>
							<div style="font-size: 0.9em; opacity: 0.8;">
								{{ witchWindowRemaining }}{{ i18n.ts._werewolf.secondsRemaining }}
							</div>
						</div>
						<div v-if="witchCanPoison" class="_gaps_s">
							<div style="margin-bottom: 8px; font-size: 0.9em;">{{ i18n.ts._werewolf.selectPoisonTarget }}</div>
							<div v-for="player in selectablePlayers" :key="player.userId"
								class="_button"
								style="padding: 12px; display: flex; align-items: center; cursor: pointer;"
								:style="{ background: selectedTarget === player.userId ? 'var(--MI_THEME-accent)' : '' }"
								@click="selectTarget(player.userId)">
								<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
								<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
							</div>
							<MkButton v-if="selectedTarget" danger @click="submitAction('poison', selectedTarget)">
								<i class="ti ti-poison"></i> {{ i18n.ts._werewolf.usePoison }}
							</MkButton>
						</div>
						<div v-else style="text-align: center; opacity: 0.6; padding: 8px;">
							{{ i18n.ts._werewolf.poisonUsed }}
						</div>
					</div>

					<MkButton v-if="witchCanSkip" @click="submitAction('skip')" style="width: 100%;">
						<i class="ti ti-x"></i> {{ i18n.ts._werewolf.skip }}
					</MkButton>
				</div>
			</div>

			<div v-if="game.phase === 'voting' && myPlayer?.isAlive" class="_panel" style="padding: 16px; margin-bottom: 16px; background: var(--MI_THEME-panelHighlight);">
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
					<div style="display: flex; align-items: center; gap: 12px;">
						<div style="font-weight: bold;">
							<i class="ti ti-checkbox"></i> {{ i18n.ts._werewolf.vote }}
						</div>
						<div v-if="votingTimeRemaining !== null" class="voting-timer" style="display: flex; align-items: center; font-size: 0.9em;">
							<i class="ti ti-clock" style="margin-right: 4px;"></i>
							<span style="font-weight: bold;">{{ votingTimeRemaining }}s</span>
							<span style="opacity: 0.7; margin-left: 2px;">/ {{ votingTimeTotal }}s</span>
						</div>
					</div>
					<div v-if="votingRound > 1" style="font-size: 0.9em; padding: 4px 8px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border-radius: 4px;">
						{{ i18n.ts._werewolf.round }} {{ votingRound }}
					</div>
				</div>

				<div v-if="votingRound === 2 && tiedPlayers.length > 0" style="margin-bottom: 12px; padding: 12px; background: var(--MI_THEME-accentedBg); border-radius: 8px;">
					<div style="font-weight: bold; margin-bottom: 8px; font-size: 0.9em;">
						<i class="ti ti-alert-triangle"></i> {{ i18n.ts._werewolf.tiedPlayers }}:
					</div>
					<div style="display: flex; gap: 8px; flex-wrap: wrap;">
						<div v-for="playerId in tiedPlayers" :key="playerId" style="display: flex; align-items: center; padding: 4px 8px; background: var(--MI_THEME-panel); border-radius: 6px;">
							<MkAvatar :user="getUserById(playerId)" style="width: 24px; height: 24px; margin-right: 6px;"/>
							<MkUserName :user="getUserById(playerId)" style="font-size: 0.85em;"/>
						</div>
					</div>
				</div>

				<div class="_gaps_s">
					<div v-for="player in alivePlayers" :key="player.userId"
						class="_button"
						:class="{ '_button--disabled': !canVoteForPlayer(player.userId) }"
						style="padding: 12px; display: flex; align-items: center; cursor: pointer;"
						:style="{
							background: selectedTarget === player.userId ? 'var(--MI_THEME-accent)' : '',
							opacity: canVoteForPlayer(player.userId) ? 1 : 0.5,
							pointerEvents: canVoteForPlayer(player.userId) ? 'auto' : 'none'
						}"
						@click="selectTarget(player.userId)">
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
						<span v-if="!canVoteForPlayer(player.userId)" style="font-size: 0.85em; opacity: 0.7; margin-left: 8px;">
							<i class="ti ti-lock"></i>
						</span>
					</div>
					<MkButton v-if="selectedTarget" primary @click="submitAction('vote', selectedTarget)">
						{{ i18n.ts._werewolf.confirmVote }}
					</MkButton>
				</div>
			</div>

			<div v-if="game.phase === 'hunter_shooting' && myRole === 'hunter' && !myPlayer?.isAlive" class="_panel" style="padding: 16px; margin-bottom: 16px; background: var(--MI_THEME-panelHighlight);">
				<div style="font-weight: bold; margin-bottom: 12px;">
					<i class="ti ti-gun"></i> {{ i18n.ts._werewolf.hunterShoot }}
				</div>
				<div class="_gaps_s">
					<div v-for="player in alivePlayers" :key="player.userId"
						class="_button"
						style="padding: 12px; display: flex; align-items: center; cursor: pointer;"
						:style="{ background: selectedTarget === player.userId ? 'var(--MI_THEME-accent)' : '' }"
						@click="selectTarget(player.userId)">
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
					</div>
					<MkButton v-if="selectedTarget" danger @click="submitAction('shoot', selectedTarget)">
						{{ i18n.ts._werewolf.confirmShoot }}
					</MkButton>
				</div>
			</div>

			<div v-if="myRole === 'werewolf' && myPlayer?.isAlive && game.phase === 'day' && game.subPhase === 'discussion'" class="_buttonsCenter" style="margin-bottom: 16px;">
				<MkButton danger @click="selfDestruct">
					<i class="ti ti-bomb"></i> {{ i18n.ts._werewolf.selfDestruct }}
				</MkButton>
			</div>

			<div style="margin: 16px 0;">
				<div style="font-weight: bold; margin-bottom: 8px;">
					<i class="ti ti-users"></i> {{ i18n.ts._werewolf.alivePlayers }}
				</div>
				<div class="_gaps_s">
					<div v-for="player in alivePlayers" :key="player.userId" class="_panel" style="padding: 12px; display: flex; align-items: center;">
						<div style="min-width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border-radius: 50%; font-weight: bold; margin-right: 8px; font-size: 0.9em;">
							{{ player.seat + 1 }}
						</div>
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<div style="flex: 1;">
							<MkUserName :user="getUserById(player.userId)"/>
							<div v-if="player.userId === $i.id && myRole" style="font-size: 0.85em; opacity: 0.7; margin-top: 2px;">
								({{ getRoleText(myRole) }})
							</div>
							<div v-else-if="player.revealRole && player.role" style="font-size: 0.85em; opacity: 0.7; margin-top: 2px;">
								({{ getRoleText(player.role) }})
							</div>
							<div v-else-if="myRole === 'werewolf' && player.role === 'werewolf' && player.userId !== $i.id" style="font-size: 0.85em; color: var(--MI_THEME-error); margin-top: 2px;">
								({{ getRoleText('werewolf') }})
							</div>
						</div>
						<span v-if="activeSpeakers.has(player.userId)" style="margin-left: 8px; color: var(--MI_THEME-accent); animation: speaking-pulse 1.5s ease-in-out infinite;">
							<i class="ti ti-microphone"></i>
						</span>
					</div>
				</div>
			</div>

			<div v-if="deadPlayers.length > 0" style="margin: 16px 0;">
				<div style="font-weight: bold; margin-bottom: 8px; opacity: 0.6;">
					<i class="ti ti-ghost"></i> {{ i18n.ts._werewolf.deadPlayers }}
				</div>
				<div class="_gaps_s">
					<div v-for="player in deadPlayers" :key="player.userId" class="_panel" style="padding: 12px; display: flex; align-items: center; opacity: 0.5;">
						<div style="min-width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--MI_THEME-panel); border: 2px solid var(--MI_THEME-divider); color: var(--MI_THEME-fg); border-radius: 50%; font-weight: bold; margin-right: 8px; font-size: 0.9em;">
							{{ player.seat + 1 }}
						</div>
						<MkAvatar :user="getUserById(player.userId)" style="width: 32px; height: 32px; margin-right: 8px;"/>
						<MkUserName :user="getUserById(player.userId)" style="flex: 1;"/>
						<span v-if="player.revealRole" style="margin-left: 8px; font-size: 0.9em;">
							({{ getRoleText(player.role) }})
						</span>
					</div>
				</div>
			</div>

			<div v-if="transitionDelay" class="transition-delay-overlay">
				<template v-if="transitionDelay.type === 'death_announcement'">
					<div class="death-announcement-content">
						<div class="death-announcement-icon">
							<i class="ti ti-ghost"></i>
						</div>
						<div class="death-announcement-message">
							<template v-if="transitionDelay.context.reason === 'died_at_night'">
								<div class="death-title">{{ i18n.ts._werewolf.dawnBreaks }}</div>
								<div class="death-subtitle">
									{{ transitionDelay.context.count === 1
										? i18n.ts._werewolf.onePlayerDied
										: i18n.ts._werewolf.multiplePlayersDied.replace('{count}', transitionDelay.context.count) }}
								</div>
							</template>
							<template v-else-if="transitionDelay.context.reason === 'voted_out'">
								<div class="death-title">{{ i18n.ts._werewolf.playerExecuted }}</div>
								<div class="death-player">
									<MkAvatar :user="getUserById(transitionDelay.context.userId)" style="width: 48px; height: 48px; margin-right: 12px;"/>
									<MkUserName :user="getUserById(transitionDelay.context.userId)" style="font-size: 1.2em; font-weight: bold;"/>
								</div>
							</template>
							<template v-else-if="transitionDelay.context.reason === 'shot_by_hunter'">
								<div class="death-title">{{ i18n.ts._werewolf.hunterRevenge }}</div>
								<div class="death-player">
									<MkAvatar :user="getUserById(transitionDelay.context.userId)" style="width: 48px; height: 48px; margin-right: 12px;"/>
									<MkUserName :user="getUserById(transitionDelay.context.userId)" style="font-size: 1.2em; font-weight: bold;"/>
								</div>
							</template>
							<template v-else-if="transitionDelay.context.reason === 'self_destructed'">
								<div class="death-title">{{ i18n.ts._werewolf.bombExploded }}</div>
								<div class="death-player">
									<MkAvatar :user="getUserById(transitionDelay.context.userId)" style="width: 48px; height: 48px; margin-right: 12px;"/>
									<MkUserName :user="getUserById(transitionDelay.context.userId)" style="font-size: 1.2em; font-weight: bold;"/>
								</div>
							</template>
						</div>
						<div class="death-announcement-timer">
							{{ (transitionDelay.remaining / 1000).toFixed(1) }}s
						</div>
					</div>
				</template>

				<template v-else>
					<div class="transition-delay-content">
						<div class="transition-delay-icon">
							<i v-if="transitionDelay.type === 'speech_transition'" class="ti ti-message-forward"></i>
							<i v-else-if="transitionDelay.type === 'discussion_to_voting'" class="ti ti-checkbox"></i>
							<i v-else-if="transitionDelay.type === 'voting_results'" class="ti ti-chart-bar"></i>
						</div>
						<div class="transition-delay-message">
							<template v-if="transitionDelay.type === 'speech_transition'">
								{{ i18n.ts._werewolf.nextSpeakerPreparing }}
							</template>
							<template v-else-if="transitionDelay.type === 'discussion_to_voting'">
								{{ i18n.ts._werewolf.preparingForVoting }}
							</template>
							<template v-else-if="transitionDelay.type === 'voting_results'">
								{{ i18n.ts._werewolf.votingResultsDisplay }}
							</template>
						</div>
						<div class="transition-delay-timer">
							{{ (transitionDelay.remaining / 1000).toFixed(1) }}s
						</div>
					</div>
				</template>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted, onUnmounted, shallowRef } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { ensureSignin } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import { AudioProcessor } from '@/composables/audio-processor';

const $i = ensureSignin();
const router = useRouter();

const props = defineProps<{
	gameId: string;
}>();

const game = shallowRef<any | null>(null);
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['werewolfGame']> | null>(null);
const selectedTarget = ref<string | null>(null);
const currentSpeaker = ref<string | null>(null);
const hasAttemptedAutoSeat = ref(false);
const countdown = ref<number | null>(null);
const isTogglingReady = ref(false);

const nightPhaseTimeRemaining = ref<number | null>(null);
const nightPhaseTotalTime = ref<number | null>(null);

const witchCurrentWindow = ref<string | null>(null);
const witchWindowRemaining = ref<number | null>(null);
const witchAllowedActions = ref<string[]>([]);
const witchUiState = ref<any>({});

const votingRound = ref<number>(1);
const tiedPlayers = ref<string[]>([]);

const votingTimeRemaining = ref<number | null>(null);
const votingTimeTotal = ref<number | null>(null);

const transitionDelay = ref<{
	type: 'death_announcement' | 'speech_transition' | 'discussion_to_voting' | 'voting_results';
	duration: number;
	remaining: number;
	context: any;
} | null>(null);

const voiceConnected = ref(false);
const localMuted = ref(false);
const peerConnection = shallowRef<RTCPeerConnection | null>(null);
const localStream = shallowRef<MediaStream | null>(null);
const remoteStreams = ref<Map<string, MediaStream>>(new Map());
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map());
const voiceCredentials = ref<{ sessionId: string } | null>(null);
let audioProcessor: AudioProcessor | null = null;
let rawMicStream: MediaStream | null = null;

const currentVoicePermissions = ref<Record<string, boolean>>({});

const lobbyMessages = ref<Array<{ userId: string; message: string; timestamp: number }>>([]);
const gameMessages = ref<Array<{ userId: string; message: string; timestamp: number }>>([]);
const werewolfMessages = ref<Array<{ userId: string; message: string; timestamp: number }>>([]);
const deadMessages = ref<Array<{ userId: string; message: string; timestamp: number }>>([]);
const chatInput = ref('');

const activeSpeakers = ref<Set<string>>(new Set());
const audioContext = shallowRef<AudioContext | null>(null);
const localAnalyser = shallowRef<AnalyserNode | null>(null);

const gameHistory = ref<any | null>(null);

const isHost = computed(() => game.value?.hostId === $i.id);

const occupiedSeats = computed(() => {
	if (!game.value?.seats) return [];
	return game.value.seats.filter((s: any) => s.userId !== null);
});

const mySeat = computed(() => {
	if (!game.value?.seats) return null;
	const seat = game.value.seats.find((s: any) => s.userId === $i.id);
	return seat ? seat.seatNumber : null;
});

const isReady = computed(() => game.value?.readyPlayers?.includes($i.id) ?? false);

function getSeatPosition(seatNum: number, totalSeats: number): Record<string, string> {
	const halfSeats = Math.ceil(totalSeats / 2);
	const isLeftSide = seatNum < halfSeats;

	const indexOnSide = isLeftSide ? seatNum : seatNum - halfSeats;
	const seatsOnSide = isLeftSide ? halfSeats : totalSeats - halfSeats;

	const verticalSpacing = 120;
	const startY = -((seatsOnSide - 1) * verticalSpacing) / 2;
	const y = startY + (indexOnSide * verticalSpacing);

	const horizontalOffset = 250;
	const x = isLeftSide ? -horizontalOffset : horizontalOffset;

	return {
		position: 'absolute',
		left: `calc(50% + ${x}px)`,
		top: `calc(50% + ${y}px)`,
		transform: 'translate(-50%, -50%)',
	};
}

function getSeatByNumber(seatNum: number): any {
	if (!game.value?.seats) return null;
	return game.value.seats.find((s: any) => s.seatNumber === seatNum);
}

function getUserBySeat(seatNum: number): any {
	const seat = getSeatByNumber(seatNum);
	if (!seat || !seat.userId) return null;
	return game.value?.allPlayers?.find((u: any) => u.id === seat.userId) ?? null;
}

function canTakeSeat(seatNum: number): boolean {
	if (!game.value || game.value.phase !== 'waiting') return false;
	const seat = getSeatByNumber(seatNum);
	if (!seat) return false;

	if (isReady.value) return false;

	return seat.userId === null && !seat.locked;
}

async function handleSeatClick(seatNum: number) {
	if (!canTakeSeat(seatNum)) {
		return;
	}

	try {
		await misskeyApi('werewolf/take-seat', {
			gameId: props.gameId,
			seatNumber: seatNum,
		});
		await fetchGame();
	} catch (err) {
		console.error('[Werewolf] Failed to take seat:', err);
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Failed to take seat',
		});
	}
}

async function leaveSeat() {
	if (mySeat.value === null) return;

	try {
		cleanupVoiceConnection();

		await misskeyApi('werewolf/leave', {
			gameId: props.gameId,
		});
	} catch (err) {
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Failed to leave seat',
		});
	}
}

async function toggleReady() {
	if (isTogglingReady.value) return;
	if (!game.value) return;

	isTogglingReady.value = true;
	const wasReady = isReady.value;

	try {
		const newReadyPlayers = wasReady
			? game.value.readyPlayers.filter((id: string) => id !== $i.id)
			: [...game.value.readyPlayers, $i.id];

		game.value = {
			...game.value,
			readyPlayers: newReadyPlayers,
		};

		if (wasReady) {
			await misskeyApi('werewolf/unready', { gameId: props.gameId });
		} else {
			await misskeyApi('werewolf/ready', { gameId: props.gameId });
		}
	} catch (err) {
		await fetchGame();
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Failed to toggle ready',
		});
	} finally {
		isTogglingReady.value = false;
	}
}

const myRole = computed(() => {
	if (!game.value || !game.value.players) return null;
	const me = game.value.players.find((p: any) => p.userId === $i.id);
	return me?.role ?? null;
});

const myPlayer = computed(() => {
	if (!game.value || !game.value.players) return null;
	return game.value.players.find((p: any) => p.userId === $i.id) ?? null;
});

const alivePlayers = computed(() => {
	if (!game.value || !game.value.players) return [];
	return game.value.players.filter((p: any) => p.isAlive);
});

const deadPlayers = computed(() => {
	if (!game.value || !game.value.players) return [];
	return game.value.players.filter((p: any) => !p.isAlive);
});

const selectablePlayers = computed(() => {
	if (!game.value || !game.value.players) return [];
	return game.value.players.filter((p: any) => p.isAlive && p.userId !== $i.id);
});

const currentSpeakerUser = computed(() => {
	if (!currentSpeaker.value || !game.value || !game.value.players) return null;
	const player = game.value.players.find((p: any) => p.userId === currentSpeaker.value);
	return player ? getUserById(player.userId) : null;
});

const isTestamentPhase = computed(() => game.value?.phase === 'testament');

const canSkipSpeech = computed(() => {
	if (!game.value || !currentSpeaker.value) return false;
	if (game.value.phase !== 'day' && game.value.phase !== 'testament') return false;
	return currentSpeaker.value === $i.id || isHost.value;
});

const canDoNightAction = computed(() => {
	if (!game.value || game.value.phase !== 'night' || !myPlayer.value?.isAlive) return false;

	const role = myRole.value;
	const subPhase = game.value.subPhase;

	return (role === 'werewolf' && subPhase === 'werewolf_turn') ||
	       (role === 'seer' && subPhase === 'seer_turn') ||
	       (role === 'witch' && subPhase === 'witch_turn');
});

const witchCanHeal = computed(() => {
	if (myRole.value !== 'witch') return false;
	return witchAllowedActions.value.includes('heal') && witchUiState.value.hasAntidote === true;
});

const witchCanPoison = computed(() => {
	if (myRole.value !== 'witch') return false;
	return witchAllowedActions.value.includes('poison') && witchUiState.value.hasPoison === true;
});

const witchCanSkip = computed(() => {
	if (myRole.value !== 'witch') return false;
	return witchAllowedActions.value.includes('skip');
});

const groupedLogs = computed(() => {
	if (!gameHistory.value?.logs) return [];
	const groups = new Map<number, any[]>();
	gameHistory.value.logs.forEach((log: any) => {
		if (!groups.has(log.day)) {
			groups.set(log.day, []);
		}
		groups.get(log.day)!.push(log);
	});
	return Array.from(groups.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([day, events]) => ({ day, events }));
});

const visibleMessages = computed(() => {
	if (!game.value) return lobbyMessages.value;

	const phase = game.value.phase;
	const subPhase = game.value.subPhase;
	const isAlive = myPlayer.value?.isAlive ?? true;
	const role = myRole.value;

	if (phase === 'waiting') {
		return lobbyMessages.value;
	}

	if (!isAlive) {
		return [...gameMessages.value, ...deadMessages.value].sort((a, b) => a.timestamp - b.timestamp);
	}

	if (phase === 'night' && subPhase === 'werewolf_turn' && role === 'werewolf') {
		return [...gameMessages.value, ...werewolfMessages.value].sort((a, b) => a.timestamp - b.timestamp);
	}

	return gameMessages.value;
});

const canSendMessage = computed(() => {
	if (!game.value || mySeat.value === null) return false;

	const phase = game.value.phase;
	const subPhase = game.value.subPhase;
	const isAlive = myPlayer.value?.isAlive ?? true;
	const role = myRole.value;

	if (phase === 'waiting') return true;

	if (!isAlive) return true;

	if (phase === 'night') {
		return subPhase === 'werewolf_turn' && role === 'werewolf';
	}

	if (phase === 'day' || phase === 'voting' || phase === 'testament') {
		return isAlive;
	}

	return false;
});

const currentChannelType = computed((): 'game' | 'dead' => {
	if (!game.value) return 'game';

	const phase = game.value.phase;
	const isAlive = myPlayer.value?.isAlive ?? true;

	if (!isAlive) return 'dead';

	return 'game';
});

const currentChatTitle = computed(() => {
	if (!game.value) return i18n.ts._werewolf.chat || 'Chat';

	const phase = game.value.phase;
	const subPhase = game.value.subPhase;
	const isAlive = myPlayer.value?.isAlive ?? true;
	const role = myRole.value;

	if (phase === 'waiting') {
		return i18n.ts._werewolf.lobbyChat;
	}

	if (!isAlive) {
		return i18n.ts._werewolf.deadChat;
	}

	if (phase === 'night' && subPhase === 'werewolf_turn' && role === 'werewolf') {
		return i18n.ts._werewolf.werewolfChat;
	}

	return i18n.ts._werewolf.chat;
});

function canVoteForPlayer(playerId: string): boolean {
	if (game.value?.phase !== 'voting') return false;
	if (votingRound.value === 2 && tiedPlayers.value.includes($i.id)) {
		if (playerId === $i.id) return false;
	}
	return true;
}

function getUserById(userId: string): any {
	if (!game.value) return null;
	if (!game.value.players) {
		return game.value.allPlayers?.find((u: any) => u.id === userId) ?? null;
	}
	const player = game.value.players.find((p: any) => p.userId === userId);
	if (!player) return null;
	return game.value.allPlayers?.find((u: any) => u.id === userId) ?? null;
}

function selectTarget(userId: string) {
	selectedTarget.value = userId;
}

function getPlayerName(userId: string): string {
	const user = getUserById(userId);
	return user?.name || user?.username || i18n.ts._werewolf.unknownPlayer;
}

function formatEventDescription(event: any): string {
	const type = event.type;
	const data = event.data || {};

	switch (type) {
		case 'night_kill':
			return `${getPlayerName(data.targetId)} ${i18n.ts._werewolf.wasKilledByWerewolves}`;
		case 'witch_heal':
			return `${i18n.ts._werewolf.witchUsedHeal}`;
		case 'witch_poison':
			return `${i18n.ts._werewolf.witchUsedPoison} ${getPlayerName(data.targetId)}`;
		case 'seer_check':
			return `${i18n.ts._werewolf.seerChecked} ${getPlayerName(data.targetId)}`;
		case 'vote':
			return `${getPlayerName(data.voterId)} ${i18n.ts._werewolf.votedFor} ${getPlayerName(data.targetId)}`;
		case 'execution':
			return `${getPlayerName(data.targetId)} ${i18n.ts._werewolf.wasExecuted}`;
		case 'hunter_shoot':
			return `${i18n.ts._werewolf.hunterShot} ${getPlayerName(data.targetId)}`;
		case 'self_destruct':
			return `${getPlayerName(data.userId)} ${i18n.ts._werewolf.selfDestructed}`;
		default:
			return event.message || JSON.stringify(event);
	}
}

function getPhaseText(phase: string, subPhase?: string): string {
	if (phase === 'night' && subPhase) {
		const subPhases: Record<string, string> = {
			werewolf_turn: i18n.ts._werewolf.werewolfTurn,
			witch_turn: i18n.ts._werewolf.witchTurn,
			seer_turn: i18n.ts._werewolf.seerTurn,
		};
		return subPhases[subPhase] || i18n.ts._werewolf.night;
	}

	if (phase === 'day' && subPhase === 'discussion') {
		return i18n.ts._werewolf.discussion;
	}

	const phases: Record<string, string> = {
		night: i18n.ts._werewolf.night,
		day: i18n.ts._werewolf.day,
		testament: i18n.ts._werewolf.testament,
		voting: i18n.ts._werewolf.voting,
		hunter_shooting: i18n.ts._werewolf.hunterShooting,
		ended: i18n.ts._werewolf.ended,
	};
	return phases[phase] || phase;
}

function getRoleText(role: string): string {
	const roles: Record<string, string> = {
		seer: i18n.ts._werewolf.seer,
		witch: i18n.ts._werewolf.witch,
		hunter: i18n.ts._werewolf.hunter,
		villager: i18n.ts._werewolf.villager,
		werewolf: i18n.ts._werewolf.werewolf,
	};
	return roles[role] || role;
}

function getRoleDescription(role: string): string {
	const descriptions: Record<string, string> = {
		seer: i18n.ts._werewolf.seerDesc,
		witch: i18n.ts._werewolf.witchDesc,
		hunter: i18n.ts._werewolf.hunterDesc,
		villager: i18n.ts._werewolf.villagerDesc,
		werewolf: i18n.ts._werewolf.werewolfDesc,
	};
	return descriptions[role] || '';
}

async function autoTakeSeat() {
	if (!game.value || game.value.phase !== 'waiting' || mySeat.value !== null) {
		return;
	}

	const sortedSeats = [...game.value.seats].sort((a: any, b: any) => a.seatNumber - b.seatNumber);
	const firstEmptySeat = sortedSeats.find((s: any) => s.userId === null && !s.locked);

	if (firstEmptySeat) {
		console.log('[Werewolf] Auto-taking seat:', firstEmptySeat.seatNumber);
		try {
			await misskeyApi('werewolf/take-seat', {
				gameId: props.gameId,
				seatNumber: firstEmptySeat.seatNumber,
			});
			const updated = await misskeyApi('werewolf/show', {
				gameId: props.gameId,
			});
			game.value = updated;
		} catch (err) {
			console.error('[Werewolf] Auto-seat failed:', err);
		}
	}
}

async function fetchGame() {
	const fetchedGame = await misskeyApi('werewolf/show', {
		gameId: props.gameId,
	});

	game.value = {
		...fetchedGame,
		readyPlayers: fetchedGame.readyPlayers ?? [],
	};

	if (fetchedGame.myRoleState) {
		const roleState = fetchedGame.myRoleState;

		if (roleState.role === 'witch' && roleState.uiState) {
			witchUiState.value = roleState.uiState;
			witchCurrentWindow.value = roleState.window;
			witchWindowRemaining.value = roleState.windowRemaining;
			witchAllowedActions.value = roleState.allowedActions || [];
		}

	}

	if (game.value.phase === 'waiting' && mySeat.value === null && !hasAttemptedAutoSeat.value) {
		hasAttemptedAutoSeat.value = true;
		await autoTakeSeat();
	}

	if (game.value.phase === 'waiting' && game.value.config.voiceEnabled && mySeat.value !== null && !voiceConnected.value) {
		initVoiceConnection();
	}
}

function initializeConnection() {
	if (connection.value) {
		connection.value.dispose();
	}

	connection.value = useStream().useChannel('werewolfGame', {
		gameId: props.gameId,
	});

	connection.value.on('seatChanged', async () => {
		await fetchGame();
		if (game.value?.phase === 'waiting' && game.value.config.voiceEnabled && mySeat.value !== null && !voiceConnected.value) {
			initVoiceConnection();
		}
	});

	connection.value.on('playerReady', async () => {
		await fetchGame();
	});

	connection.value.on('playerUnready', async () => {
		await fetchGame();
	});

	connection.value.on('countdownStarted', () => {
		countdown.value = 3;
	});

	connection.value.on('countdownTick', (x) => {
		countdown.value = x.remaining;
	});

	connection.value.on('countdownCancelled', () => {
		countdown.value = null;
	});

	connection.value.on('gameStarted', (x) => {
		game.value = x.game;
		countdown.value = null;
	});

	connection.value.on('phaseChanged', (x) => {
		if (game.value) {
			game.value = {
				...game.value,
				phase: x.phase,
				dayNumber: x.dayNumber,
				...(x.subPhase !== undefined ? { subPhase: x.subPhase } : {}),
			};
			selectedTarget.value = null;

			if (x.voicePermissions) {
				handleVoicePermissions(x.voicePermissions);
			} else {
				updateVoiceMuteState();
			}
		}
	});

	connection.value.on('subPhaseChanged', (x) => {
		if (game.value) {
			game.value.subPhase = x.subPhase;
			selectedTarget.value = null;

			if (x.voicePermissions) {
				handleVoicePermissions(x.voicePermissions);
			} else {
				updateVoiceMuteState();
			}
		}
	});

	connection.value.on('speakerChanged', (x) => {
		currentSpeaker.value = x.userId;
		updateVoiceMuteState();
	});

	connection.value.on('discussionEnded', () => {
		currentSpeaker.value = null;
	});

	connection.value.on('testamentNext', (x) => {
		currentSpeaker.value = x.userId;
	});

	connection.value.on('playerDied', async (x) => {
		if (x.players && game.value) {
			game.value.players = x.players;
		}
		await fetchGame();
	});

	connection.value.on('gameEnded', async (x) => {
		game.value = x.game;
		try {
			gameHistory.value = await misskeyApi('werewolf/game-history', {
				gameId: props.gameId,
			});
		} catch (err) {
			console.error('Failed to fetch game history:', err);
		}
	});

	connection.value.on('playerKicked', (x) => {
		if (x.userId === $i.id) {
			connection.value?.dispose();
			os.alert({
				type: 'error',
				text: `${i18n.ts._werewolf.kickedFromGame}: ${x.reason === 'ready_timeout' ? i18n.ts._werewolf.readyTimeout : x.reason}`,
			});
			router.push('/werewolf');
		} else {
			fetchGame();
		}
	});

	connection.value.on('gameCanceled', () => {
		connection.value?.dispose();
		os.alert({
			type: 'warning',
			text: i18n.ts._werewolf.gameCanceled,
		});
		router.push('/werewolf');
	});

	connection.value.on('message', (x) => {
		const msg = {
			userId: x.userId,
			message: x.message,
			timestamp: Date.now(),
		};

		switch (x.channel) {
			case 'lobby':
				lobbyMessages.value.push(msg);
				break;
			case 'werewolf':
				werewolfMessages.value.push(msg);
				break;
			case 'dead':
				deadMessages.value.push(msg);
				break;
			case 'game':
			default:
				gameMessages.value.push(msg);
				break;
		}
	});

	connection.value.on('voiceTrackReady', async (x) => {
		if (!x.userId || x.userId === $i.id) return;
		if (!voiceConnected.value || !peerConnection.value) return;

		const speakerHasPermission = currentVoicePermissions.value[x.userId];

		if (speakerHasPermission === false) {
			return;
		}

		await pullSingleRemoteTrack(x.userId, x.sessionId, x.trackName);
	});

	connection.value.on('voiceTrackAdded', async (x) => {
		if (!x.userId || x.userId === $i.id) return;
	});

	connection.value.on('votingTied', (x) => {
		if (!game.value) return;

		votingRound.value = (x.round ?? 1) + 1;
		tiedPlayers.value = x.tiedPlayers ?? [];

		if (x.round === 1) {
			os.toast(i18n.ts._werewolf.votingTiedRound1);
		} else {
			os.toast(i18n.ts._werewolf.votingTiedRound2);
		}
	});

	connection.value.on('secondRoundDiscussionStarted', (x) => {
		if (!game.value) return;

		selectedTarget.value = null;

		os.toast(i18n.ts._werewolf.secondRoundStarted);
	});

	connection.value.on('nightPhaseTimeUpdate', (x) => {
		nightPhaseTimeRemaining.value = x.remaining;
		nightPhaseTotalTime.value = x.total;
	});

	connection.value.on('witchTimeWindowUpdate', (x) => {
		witchCurrentWindow.value = x.window;
		witchWindowRemaining.value = x.windowRemaining;
		witchAllowedActions.value = x.allowedActions || [];
		witchUiState.value = x.uiState || {};
	});

	connection.value.on('votingTimeUpdate', (x) => {
		votingTimeRemaining.value = x.remaining;
		votingTimeTotal.value = x.total;

		if (x.remaining === 0) {
			votingTimeRemaining.value = null;
			votingTimeTotal.value = null;
		}
	});

	connection.value.on('transitionDelay', (x) => {
		transitionDelay.value = {
			type: x.type,
			duration: x.duration,
			remaining: x.duration,
			context: x,
		};

		const startTime = Date.now();
		const interval = window.setInterval(() => {
			if (!transitionDelay.value) {
				window.clearInterval(interval);
				return;
			}

			const elapsed = Date.now() - startTime;
			const remaining = Math.max(0, x.duration - elapsed);

			transitionDelay.value.remaining = remaining;

			if (remaining === 0) {
				window.clearInterval(interval);
				window.setTimeout(() => {
					transitionDelay.value = null;
				}, 300);
			}
		}, 100);
	});
}

async function submitAction(action: string, target?: string) {
	try {
		await misskeyApi('werewolf/action', {
			gameId: props.gameId,
			action,
			target,
		});
		selectedTarget.value = null;
	} catch (err) {
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Action failed',
		});
	}
}

async function skipSpeech() {
	try {
		await misskeyApi('werewolf/skip-speech', {
			gameId: props.gameId,
		});
	} catch (err) {
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Failed to skip speech',
		});
	}
}

async function selfDestruct() {
	const confirm = await os.confirm({
		type: 'warning',
		text: i18n.ts._werewolf.confirmSelfDestruct || 'Are you sure you want to self-destruct?',
	});

	if (!confirm.canceled) {
		try {
			await misskeyApi('werewolf/self-destruct', {
				gameId: props.gameId,
			});
		} catch (err) {
			os.alert({
				type: 'error',
				text: (err as any)?.message || 'Self-destruct failed',
			});
		}
	}
}

function backToLobby() {
	router.push('/werewolf');
}

async function sendChatMessage() {
	if (!chatInput.value.trim() || mySeat.value === null) return;

	try {
		await misskeyApi('werewolf/send-message', {
			gameId: props.gameId,
			message: chatInput.value.trim(),
			channelType: currentChannelType.value,
		});
		chatInput.value = '';
	} catch (err) {
		os.alert({
			type: 'error',
			text: (err as any)?.message || 'Failed to send message',
		});
	}
}

function handleVoicePermissions(voicePermissions: Record<string, boolean>) {
	currentVoicePermissions.value = voicePermissions;

	const myPermission = voicePermissions[$i.id];

	if (myPermission && !voiceConnected.value) {
		initVoiceConnection();
	}

	if (!myPermission && voiceConnected.value) {
		cleanupVoiceConnection();
	}

	if (myPermission && voiceConnected.value) {
		updateVoiceMuteState();
	}
}

function updateVoiceMuteState() {
	if (!voiceConnected.value || !localStream.value || !game.value) return;

	const audioTrack = localStream.value.getAudioTracks()[0];
	if (!audioTrack) return;

	const phase = game.value.phase;
	const subPhase = game.value.subPhase;
	const myRole = myPlayer.value?.role;
	const isAlive = myPlayer.value?.isAlive;
	const speaker = currentSpeaker.value;

	let shouldUnmute = false;

	if (phase === 'waiting') {
		shouldUnmute = true;
	} else if (phase === 'night' && subPhase === 'werewolf_turn') {
		shouldUnmute = (myRole === 'werewolf');
	} else if (phase === 'day' && subPhase === 'discussion') {
		shouldUnmute = (speaker === $i.id);
	} else if (phase === 'testament') {
		shouldUnmute = (speaker === $i.id);
	} else {
		shouldUnmute = false;
	}

	if (!isAlive && phase !== 'testament') {
		shouldUnmute = false;
	}

	audioTrack.enabled = shouldUnmute;
	localMuted.value = !shouldUnmute;
}

async function pullSingleRemoteTrack(userId: string, sessionId: string, trackName: string) {
	if (!peerConnection.value || !voiceConnected.value) {
		return;
	}

	const pc = peerConnection.value;

	try {
		if (pc.signalingState !== 'stable') {
			await new Promise<void>((resolve) => {
				const checkStable = () => {
					if (pc.signalingState === 'stable') {
						pc.removeEventListener('signalingstatechange', checkStable);
						resolve();
					}
				};
				pc.addEventListener('signalingstatechange', checkStable);
				window.setTimeout(() => {
					pc.removeEventListener('signalingstatechange', checkStable);
					resolve();
				}, 5000);
			});
		}

		pc.addTransceiver('audio', { direction: 'recvonly' });

		const currentOffer = await pc.createOffer();
		await pc.setLocalDescription(currentOffer);

		const pullResult = await misskeyApi('werewolf/voice-pull-single-track', {
			gameId: props.gameId,
			remoteUserId: userId,
			remoteSessionId: sessionId,
			trackName: trackName,
			currentOffer: {
				type: currentOffer.type,
				sdp: currentOffer.sdp!,
			},
		}) as { answer: RTCSessionDescriptionInit | null };

		if (pullResult.answer) {
			await pc.setRemoteDescription(pullResult.answer);
		}
	} catch (err) { }
}

async function initVoiceConnection(retryCount = 0) {
	if (voiceConnected.value || !game.value?.config.voiceEnabled) return;

	try {
		const creds = await misskeyApi('werewolf/get-voice-creds', {
			gameId: props.gameId,
		}) as { sessionId: string; otherSessionIds: Record<string, string> };

		voiceCredentials.value = { sessionId: creds.sessionId };

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
		});

		peerConnection.value = pc;

		rawMicStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});

		audioProcessor = new AudioProcessor();
		localStream.value = await audioProcessor.initialize(rawMicStream);

		setupVoiceActivityDetection(rawMicStream);

		const shouldStartUnmuted = game.value?.phase === 'waiting';

		localStream.value.getAudioTracks().forEach(track => {
			pc.addTrack(track, localStream.value!);
			track.enabled = shouldStartUnmuted;
		});

		pc.ontrack = (event) => {
			if (event.streams && event.streams[0]) {
				const remoteStream = event.streams[0];
				const trackId = event.track.id;
				remoteStreams.value.set(trackId, remoteStream);

				const audio = new Audio();
				audio.srcObject = remoteStream;
				audio.autoplay = true;
				audio.play().catch(err => console.error('Failed to play remote audio:', err));
				audioElements.value.set(trackId, audio);
			}
		};

		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		if (pc.iceGatheringState !== 'complete') {
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => resolve(), 3000);
				pc.onicegatheringstatechange = () => {
					if (pc.iceGatheringState === 'complete') {
						clearTimeout(timeout);
						resolve();
					}
				};
			});
		}

		const pushResult = await misskeyApi('werewolf/voice-negotiate', {
			gameId: props.gameId,
			offer: {
				type: offer.type,
				sdp: offer.sdp!,
			},
		}) as { answer: RTCSessionDescriptionInit };

		await pc.setRemoteDescription(pushResult.answer);

		if (pc.connectionState !== 'connected') {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					resolve();
				}, 10000);

				const checkState = () => {
					if (pc.connectionState === 'connected') {
						clearTimeout(timeout);
						pc.removeEventListener('connectionstatechange', checkState);
						resolve();
					} else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
						clearTimeout(timeout);
						pc.removeEventListener('connectionstatechange', checkState);
						reject(new Error(`Connection ${pc.connectionState}`));
					}
				};

				pc.addEventListener('connectionstatechange', checkState);
				checkState();
			});
		}

		voiceConnected.value = true;
		localMuted.value = !shouldStartUnmuted;
	} catch (err) {
		cleanupVoiceConnection();

		const maxRetries = 3;
		if (retryCount < maxRetries) {
			const retryDelay = 2000 * (retryCount + 1);
			setTimeout(() => {
				initVoiceConnection(retryCount + 1);
			}, retryDelay);
		} else {
			await os.alert({
				type: 'error',
				text: 'Failed to connect to voice after multiple attempts',
			});
		}
	}
}

function toggleMute() {
	if (!localStream.value) return;

	const audioTrack = localStream.value.getAudioTracks()[0];
	if (audioTrack) {
		audioTrack.enabled = !audioTrack.enabled;
		localMuted.value = !audioTrack.enabled;
	}
}

function setupVoiceActivityDetection(stream: MediaStream) {
	try {
		audioContext.value = new AudioContext();
		const analyser = audioContext.value.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.8;
		localAnalyser.value = analyser;

		const source = audioContext.value.createMediaStreamSource(stream);
		source.connect(analyser);

		const dataArray = new Uint8Array(analyser.frequencyBinCount);

		const VOLUME_THRESHOLD = 30;
		const SPEAKING_TIMEOUT = 500;
		let isSpeaking = false;
		let lastSpeakTime = 0;

		const checkVoiceActivity = () => {
			if (!localStream.value || !voiceConnected.value) return;

			const audioTrack = localStream.value.getAudioTracks()[0];
			const isMuted = !audioTrack || !audioTrack.enabled;

			if (isMuted) {
				if (isSpeaking) {
					isSpeaking = false;
					activeSpeakers.value.delete($i.id);
				}
			} else {
				analyser.getByteFrequencyData(dataArray);
				const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

				if (average > VOLUME_THRESHOLD) {
					lastSpeakTime = Date.now();
					if (!isSpeaking) {
						isSpeaking = true;
						activeSpeakers.value.add($i.id);
					}
				} else {
					if (isSpeaking && Date.now() - lastSpeakTime > SPEAKING_TIMEOUT) {
						isSpeaking = false;
						activeSpeakers.value.delete($i.id);
					}
				}
			}

			requestAnimationFrame(checkVoiceActivity);
		};

		checkVoiceActivity();
	} catch (err) {
		console.error('[VAD] Failed to setup voice activity detection:', err);
	}
}

function cleanupVoiceConnection() {
	audioElements.value.forEach((audio) => {
		audio.pause();
		audio.srcObject = null;
	});
	audioElements.value.clear();

	if (audioContext.value) {
		audioContext.value.close();
		audioContext.value = null;
	}
	localAnalyser.value = null;
	activeSpeakers.value.clear();

	if (audioProcessor) {
		audioProcessor.cleanup();
		audioProcessor = null;
	}

	if (rawMicStream) {
		rawMicStream.getTracks().forEach(track => track.stop());
		rawMicStream = null;
	}

	if (localStream.value) {
		localStream.value.getTracks().forEach(track => track.stop());
		localStream.value = null;
	}

	if (peerConnection.value) {
		peerConnection.value.close();
		peerConnection.value = null;
	}

	voiceConnected.value = false;
	localMuted.value = false;
	remoteStreams.value.clear();
	voiceCredentials.value = null;
}

onMounted(async () => {
	await fetchGame();
	initializeConnection();
});

onUnmounted(() => {
	if (connection.value) {
		connection.value.dispose();
	}
	cleanupVoiceConnection();
});

definePage(() => ({
	title: i18n.ts._werewolf.title,
	icon: 'ti ti-moon-stars',
}));
</script>

<style scoped>
.seat-circle-container {
	position: relative;
	width: 100%;
	height: 500px;
	margin: 40px 0;
}

.seat-circle {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: 12px;
	min-width: 100px;
	cursor: default;
	border-radius: 12px;
	transition: all 0.2s ease;
}

.seat-circle--clickable {
	cursor: pointer;
}

.seat-circle--clickable:hover {
	transform: translate(-50%, -50%) scale(1.1);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.seat-circle--locked {
	opacity: 0.3;
}

.seat-circle--selected {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	box-shadow: 0 0 0 3px var(--MI_THEME-accent);
}

.seat-number-badge {
	position: absolute;
	top: 4px;
	left: 4px;
	min-width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	border-radius: 50%;
	font-weight: bold;
	font-size: 0.8em;
}

.seat-avatar-wrapper {
	position: relative;
	margin-bottom: 8px;
}

.seat-avatar-circle {
	width: 64px;
	height: 64px;
	border-radius: 50%;
	position: relative;
	z-index: 1;
}

.seat-avatar-placeholder {
	width: 64px;
	height: 64px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--MI_THEME-panel);
	border: 2px dashed var(--MI_THEME-divider);
	color: var(--MI_THEME-fg);
	font-size: 1.5em;
	opacity: 0.5;
	margin-bottom: 8px;
}

.seat-avatar-placeholder--locked {
	opacity: 0.3;
	border-style: solid;
}

.seat-role-marker {
	position: absolute;
	top: -4px;
	right: -4px;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.9em;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	z-index: 10;
}

.seat-role-marker--host {
	background: gold;
	color: #000;
}

.seat-role-marker--ready {
	background: var(--MI_THEME-accent);
	color: #fff;
	top: -4px;
	left: -4px;
}

.countdown-display {
	font-size: 3em;
	font-weight: bold;
	color: var(--MI_THEME-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
	0%, 100% {
		transform: scale(1);
		opacity: 1;
	}
	50% {
		transform: scale(1.1);
		opacity: 0.8;
	}
}

.seat-username {
	font-size: 0.85em;
	text-align: center;
	max-width: 100px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.seat-username--empty {
	opacity: 0.5;
	font-size: 0.75em;
}

@keyframes speaking-pulse {
	0%, 100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.6;
		transform: scale(1.2);
	}
}

.transition-delay-overlay {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.6);
	z-index: 1000;
	backdrop-filter: blur(4px);
}

.transition-delay-content {
	background: var(--MI_THEME-panel);
	border-radius: 16px;
	padding: 32px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	animation: fadeIn 0.3s ease-out;
}

.transition-delay-icon {
	font-size: 3em;
	color: var(--MI_THEME-accent);
	animation: pulse 1.5s ease-in-out infinite;
}

.transition-delay-message {
	font-size: 1.2em;
	font-weight: bold;
	color: var(--MI_THEME-fg);
	text-align: center;
}

.transition-delay-timer {
	font-size: 2em;
	font-weight: bold;
	color: var(--MI_THEME-accent);
	font-family: monospace;
}

@keyframes fadeIn {
	from {
		opacity: 0;
		transform: scale(0.9);
	}
	to {
		opacity: 1;
		transform: scale(1);
	}
}

.death-announcement-content {
	background: var(--MI_THEME-panel);
	border-radius: 16px;
	padding: 40px 48px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 24px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	animation: fadeIn 0.3s ease-out;
	position: relative;
	max-width: 600px;
}

.death-announcement-icon {
	font-size: 4em;
	color: var(--MI_THEME-accent);
	animation: pulse 1.5s ease-in-out infinite;
}

.death-announcement-message {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	width: 100%;
}

.death-title {
	font-size: 1.8em;
	font-weight: bold;
	color: var(--MI_THEME-fg);
	text-align: center;
}

.death-subtitle {
	font-size: 1.2em;
	color: var(--MI_THEME-fg);
	opacity: 0.8;
	text-align: center;
}

.death-player {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 16px 24px;
	background: var(--MI_THEME-panelHighlight);
	border-radius: 12px;
	margin-top: 8px;
}

.death-announcement-timer {
	position: absolute;
	top: 12px;
	right: 12px;
	font-size: 0.9em;
	font-weight: bold;
	color: var(--MI_THEME-fg);
	opacity: 0.5;
	font-family: monospace;
	padding: 4px 8px;
	background: var(--MI_THEME-panel);
	border-radius: 6px;
}
</style>
