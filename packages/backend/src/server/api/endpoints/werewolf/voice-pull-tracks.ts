/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';
import type { RTCSessionDescriptionInit } from '@/core/webrtc-types.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			answer: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					type: { type: 'string', optional: false, nullable: false },
					sdp: { type: 'string', optional: false, nullable: false },
				},
			},
		},
	},
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
		private werewolfService: WerewolfService,
		private werewolfVoiceService: WerewolfVoiceService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Get game
			const game = await this.werewolfService.get(ps.gameId);
			if (!game || game.isEnded) {
				throw new Error('Game not found or ended');
			}

			let isInGame: boolean;
			if (game.isStarted && game.players) {
				isInGame = game.players.some(p => p.userId === me.id);
			} else {
				isInGame = game.seats.some(s => s.userId === me.id);
			}

			if (!isInGame) {
				throw new Error('Player not in game');
			}

			if (!game.config.voiceEnabled) {
				throw new Error('Voice not enabled for this game');
			}

			const speakerIds = game.isStarted && game.players
				? game.players.map(player => player.userId)
				: game.seats.map(seat => seat.userId).filter(userId => userId != null);
			const allowedSpeakerIds = new Set(speakerIds.filter(speakerId =>
				this.werewolfService.canPlayerHearNow(game, me.id, speakerId)
			));

			if (allowedSpeakerIds.size === 0) {
				return { answer: null };
			}

			const answer = await this.werewolfVoiceService.pullRemoteTracks(
				ps.gameId,
				me.id,
				ps.currentOffer as RTCSessionDescriptionInit,
				allowedSpeakerIds,
			);

			if (!answer) {
				return { answer: null };
			}

			return {
				answer: {
					type: answer.type,
					sdp: answer.sdp!,
				},
			};
		});
	}
}
