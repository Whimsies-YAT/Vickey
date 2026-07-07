/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			sessionId: { type: 'string', optional: false, nullable: false },
			otherSessionIds: {
				type: 'object',
				optional: false, nullable: false,
				additionalProperties: {
					type: 'string',
				},
			},
		},
	},
	errors: {
		gameNotFound: {
			message: 'Game not found or ended',
			code: 'GAME_NOT_FOUND',
			id: 'werewolf-voice-game-not-found',
		},
		notInGame: {
			message: 'Player not in game',
			code: 'NOT_IN_GAME',
			id: 'werewolf-voice-not-in-game',
		},
		voiceNotEnabled: {
			message: 'Voice not enabled for this game',
			code: 'VOICE_NOT_ENABLED',
			id: 'werewolf-voice-not-enabled',
		},
		failedToJoin: {
			message: 'Failed to join voice call',
			code: 'FAILED_TO_JOIN',
			id: 'werewolf-voice-failed-to-join',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
	},
	required: ['gameId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private werewolfService: WerewolfService,
		private werewolfVoiceService: WerewolfVoiceService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Get game
			const game = await this.werewolfService.get(ps.gameId);
			if (!game || game.isEnded) {
				throw new Error('Game not found or ended');
			}

			// Check if user is in game (either in seats or in players)
			let isInGame = false;
			if (game.isStarted && game.players) {
				isInGame = game.players.some(p => p.userId === me.id);
			} else {
				// Waiting phase: check if user has a seat
				isInGame = game.seats.some(s => s.userId === me.id);
			}

			if (!isInGame) {
				throw new Error('Player not in game');
			}

			// Check if voice is enabled for this game
			if (!game.config.voiceEnabled) {
				throw new Error('Voice not enabled for this game');
			}

			// Check if Cloudflare Calls is configured on the server
			// This prevents connection attempts when the server lacks voice capabilities
			if (!this.werewolfVoiceService.isEnabled()) {
				throw new Error('Voice service not configured on server');
			}

			// Join voice session
			const result = await this.werewolfVoiceService.joinVoiceSession(ps.gameId, me.id);
			if (!result) {
				throw new Error('Failed to join voice call');
			}

			return {
				sessionId: result.sessionId,
				otherSessionIds: result.otherSessions,
			};
		});
	}
}
