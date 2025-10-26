/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	errors: {
		gameNotFound: {
			message: 'Game not found or ended',
			code: 'GAME_NOT_FOUND',
			id: 'werewolf-voice-negotiate-game-not-found',
		},
		notInGame: {
			message: 'Player not in game',
			code: 'NOT_IN_GAME',
			id: 'werewolf-voice-negotiate-not-in-game',
		},
		voiceNotEnabled: {
			message: 'Voice not enabled for this game',
			code: 'VOICE_NOT_ENABLED',
			id: 'werewolf-voice-negotiate-not-enabled',
		},
		negotiationFailed: {
			message: 'Failed to negotiate with voice server',
			code: 'NEGOTIATION_FAILED',
			id: 'werewolf-voice-negotiate-failed',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
		offer: {
			type: 'object',
			properties: {
				type: { type: 'string' },
				sdp: { type: 'string' },
			},
			required: ['type', 'sdp'],
		},
	},
	required: ['gameId', 'offer'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
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

			// SECURITY: Verify player has permission to speak in current phase
			const canSpeak = this.werewolfService.canPlayerSpeakNow(game, me.id);
			if (!canSpeak) {
				throw new Error('You are not allowed to speak in this phase');
			}

			// Negotiate tracks
			const answer = await this.werewolfVoiceService.negotiateTracks(
				ps.gameId,
				me.id,
				ps.offer as RTCSessionDescriptionInit,
			);

			if (!answer) {
				throw new Error('Failed to negotiate with voice server');
			}

			// Broadcast event to all game participants: new track is available
			// This allows already-connected players to dynamically pull the new track
			this.globalEventService.publishWerewolfGameStream(ps.gameId, 'voiceTrackAdded', {
				userId: me.id,
			});

			return {
				answer,
			};
		});
	}
}