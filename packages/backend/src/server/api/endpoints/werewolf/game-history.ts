/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { WerewolfGamesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	requireCredential: false,
	secure: true,

	errors: {
		noSuchGame: {
			message: 'No such game.',
			code: 'NO_SUCH_GAME',
			id: 'h1j2k3l4m-5n6o-7p8q-9r0s-1t2u3v4w5x6y',
		},
		gameNotFinished: {
			message: 'Game is not finished yet.',
			code: 'GAME_NOT_FINISHED',
			id: 'a2b3c4d5e-6f7g-8h9i-0j1k-2l3m4n5o6p7q',
		},
	},

	res: {
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id' },
			createdAt: { type: 'string', format: 'date-time' },
			startedAt: { type: 'string', format: 'date-time', nullable: true },
			endedAt: { type: 'string', format: 'date-time', nullable: true },
			isStarted: { type: 'boolean' },
			isEnded: { type: 'boolean' },
			winner: { type: 'string', nullable: true },
			logs: {
				type: 'array',
				items: {
					type: 'object',
				},
			},
			players: {
				type: 'array',
				items: {
					type: 'object',
				},
			},
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
		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const game = await this.werewolfGamesRepository.findOneBy({ id: ps.gameId });

			if (game == null) {
				throw new ApiError(meta.errors.noSuchGame);
			}

			if (!game.isEnded) {
				throw new ApiError(meta.errors.gameNotFinished);
			}

			// Return complete game history
			return {
				id: game.id,
				createdAt: game.createdAt.toISOString(),
				startedAt: game.startedAt?.toISOString() ?? null,
				endedAt: game.endedAt?.toISOString() ?? null,
				isStarted: game.isStarted,
				isEnded: game.isEnded,
				winner: game.winnerTeam,
				logs: game.logs,
				players: game.players,
			};
		});
	}
}
