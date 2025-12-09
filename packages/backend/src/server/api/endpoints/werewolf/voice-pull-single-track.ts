/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';
import { CloudflareCallsService } from '@/core/CloudflareCallsService.js';
import { DI } from '@/di-symbols.js';
import type { WerewolfGamesRepository } from '@/models/_.js';
import type { RTCSessionDescriptionInit } from '@/core/webrtc-types.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	errors: {
		gameNotFound: {
			message: 'Game not found or ended',
			code: 'GAME_NOT_FOUND',
			id: 'werewolf-voice-pull-single-game-not-found',
		},
		notInGame: {
			message: 'Player not in game',
			code: 'NOT_IN_GAME',
			id: 'werewolf-voice-pull-single-not-in-game',
		},
		voiceNotEnabled: {
			message: 'Voice not enabled for this game',
			code: 'VOICE_NOT_ENABLED',
			id: 'werewolf-voice-pull-single-not-enabled',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
		remoteUserId: { type: 'string', format: 'misskey:id' },
		remoteSessionId: { type: 'string' },
		trackName: { type: 'string' },
		currentOffer: {
			type: 'object',
			properties: {
				type: { type: 'string' },
				sdp: { type: 'string' },
			},
			required: ['type', 'sdp'],
		},
	},
	required: ['gameId', 'remoteUserId', 'remoteSessionId', 'trackName', 'currentOffer'],
} as const;

/**
 * Pull a single remote track on-demand
 *
 * Called by frontend when it receives "voiceTrackReady" event
 * This follows Cloudflare's recommended signaling architecture
 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,

		@Inject(DI.redis)
		private redisClient: any,

		private werewolfService: WerewolfService,
		private werewolfVoiceService: WerewolfVoiceService,
		private cloudflareCallsService: CloudflareCallsService,
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

			// Get voice session
			const sessionKey = `voicecall:werewolf:${ps.gameId}`;
			const sessionData = await this.redisClient.get(sessionKey);
			if (!sessionData) {
				console.error('[WerewolfVoice] Voice session not found');
				return { answer: null };
			}

			const session = JSON.parse(sessionData);
			const myState = session.participants[me.id];
			if (!myState) {
				console.error('[WerewolfVoice] User not in voice session');
				return { answer: null };
			}

			console.log('[WerewolfVoice] Pulling single track:', ps.trackName, 'from user:', ps.remoteUserId);

			// Pull single track
			const remoteTracks = [{
				location: 'remote' as const,
				trackName: ps.trackName,
				sessionId: ps.remoteSessionId,
			}];

			const pullResult = await this.cloudflareCallsService.addTrack(
				session.appId,
				session.appSecret,
				myState.sessionId,
				ps.currentOffer as RTCSessionDescriptionInit,
				remoteTracks,
			);

			if (!pullResult) {
				console.error('[WerewolfVoice] Failed to pull single track');
				return { answer: null };
			}

			if (pullResult.hasErrors) {
				console.error('[WerewolfVoice] Track pull error:', pullResult.tracks);
				return { answer: null };
			}

			console.log('[WerewolfVoice] Successfully pulled single track');

			return {
				answer: pullResult.sessionDescription,
			};
		});
	}
}
