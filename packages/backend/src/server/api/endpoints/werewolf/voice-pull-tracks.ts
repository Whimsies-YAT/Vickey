/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
import type { WerewolfGamesRepository } from '@/models/_.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	errors: {
		gameNotFound: {
			message: 'Game not found or ended',
			code: 'GAME_NOT_FOUND',
			id: 'werewolf-voice-pull-game-not-found',
		},
		notInGame: {
			message: 'Player not in game',
			code: 'NOT_IN_GAME',
			id: 'werewolf-voice-pull-not-in-game',
		},
		voiceNotEnabled: {
			message: 'Voice not enabled for this game',
			code: 'VOICE_NOT_ENABLED',
			id: 'werewolf-voice-pull-not-enabled',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
		currentOffer: {
			type: 'object',
			properties: {
				type: { type: 'string' },
				sdp: { type: 'string' },
			},
			required: ['type', 'sdp'],
		},
	},
	required: ['gameId', 'currentOffer'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,

		private werewolfService: WerewolfService,
		private werewolfVoiceService: WerewolfVoiceService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Get game
			const game = await this.werewolfService.get(ps.gameId);
			if (!game || game.isEnded) {
				throw new Error('Game not found or ended');
			}

			// Check if user is in game
			let isInGame = false;
			if (game.isStarted && game.players) {
				isInGame = game.players.some(p => p.userId === me.id);
			} else {
				isInGame = game.seats.some(s => s.userId === me.id);
			}

			if (!isInGame) {
				throw new Error('Player not in game');
			}

			// Check if voice is enabled
			if (!game.config.voiceEnabled) {
				throw new Error('Voice not enabled for this game');
			}

			// SECURITY: Check if player has permission to listen to any speakers in current phase
			// This prevents dead players from hearing alive players, non-werewolves from hearing werewolves, etc.
			const canListenToAnyone = game.players.some(speaker =>
				this.werewolfService.canPlayerHearNow(game, me.id, speaker.userId)
			);

			if (!canListenToAnyone) {
				// Player has no listening permission in current phase - return null
				// Frontend should disconnect when voicePermissions indicate no permission
				return { answer: null };
			}

			// Pull remote tracks (can be null if no tracks to pull yet)
			const answer = await this.werewolfVoiceService.pullRemoteTracks(
				ps.gameId,
				me.id,
				ps.currentOffer as RTCSessionDescriptionInit,
			);

			// Return null if no new tracks (client will retry later)
			if (!answer) {
				return { answer: null };
			}

			return {
				answer,
			};
		});
	}
}