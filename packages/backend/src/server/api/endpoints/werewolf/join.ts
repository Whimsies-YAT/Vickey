/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { ApiError } from '../../error.js';

export const meta = {
	requireCredential: true,

	kind: 'write:account',

	errors: {
		noSuchGame: {
			message: 'No such game.',
			code: 'NO_SUCH_GAME',
			id: 'b6cc7b27-3f54-4c8e-9c5d-f1e5e0c38e87',
		},

		alreadyStarted: {
			message: 'Game has already started.',
			code: 'ALREADY_STARTED',
			id: 'c3f89d51-2d6e-4f8b-9e5a-3c7f8d6e4b2a',
		},

		gameFull: {
			message: 'Game is full.',
			code: 'GAME_FULL',
			id: 'd4e8a3f2-5b7c-4e9d-8a6f-2c5e7d8f9a1b',
		},

		alreadyJoined: {
			message: 'You have already joined this game.',
			code: 'ALREADY_JOINED',
			id: 'e5f9b4g3-6c8d-5f0e-9b7g-3d6f8e9g0a2c',
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
	) {
		super(meta, paramDef, async (ps, me) => {
			const game = await this.werewolfService.get(ps.gameId);

			if (game == null) {
				throw new ApiError(meta.errors.noSuchGame);
			}

			if (game.isStarted) {
				throw new ApiError(meta.errors.alreadyStarted);
			}

			if (game.players.some(p => p.userId === me.id)) {
				throw new ApiError(meta.errors.alreadyJoined);
			}

			if (game.players.length >= game.config.maxPlayers) {
				throw new ApiError(meta.errors.gameFull);
			}

			const success = await this.werewolfService.joinGame(ps.gameId, me);

			if (!success) {
				throw new ApiError(meta.errors.noSuchGame);
			}
		});
	}
}
