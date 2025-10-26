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
			id: 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
		},

		alreadyStarted: {
			message: 'Game has already started.',
			code: 'ALREADY_STARTED',
			id: 'b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e',
		},

		notInGame: {
			message: 'You are not in this game.',
			code: 'NOT_IN_GAME',
			id: 'c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f',
		},

		alreadyReady: {
			message: 'You are already ready.',
			code: 'ALREADY_READY',
			id: 'd4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a',
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

			const hasSeat = game.seats.some(s => s.userId === me.id);
			if (!hasSeat) {
				throw new ApiError(meta.errors.notInGame);
			}

			if (game.readyPlayers.includes(me.id)) {
				throw new ApiError(meta.errors.alreadyReady);
			}

			await this.werewolfService.setReady(ps.gameId, me);
		});
	}
}
