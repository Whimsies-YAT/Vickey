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
			id: 'e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b',
		},

		alreadyStarted: {
			message: 'Game has already started.',
			code: 'ALREADY_STARTED',
			id: 'f6a7b8c9-0d1e-2f3a-4b5c-6d7e8f9a0b1c',
		},

		notInGame: {
			message: 'You are not in this game.',
			code: 'NOT_IN_GAME',
			id: 'a7b8c9d0-1e2f-3a4b-5c6d-7e8f9a0b1c2d',
		},

		notReady: {
			message: 'You are not ready.',
			code: 'NOT_READY',
			id: 'b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e',
		},

		countdownStarted: {
			message: 'Countdown has started, cannot unready.',
			code: 'COUNTDOWN_STARTED',
			id: 'c9d0e1f2-3a4b-5c6d-7e8f-9a0b1c2d3e4f',
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

			// In waiting phase, check if user has a seat
			const hasSeat = game.seats.some(s => s.userId === me.id);
			if (!hasSeat) {
				throw new ApiError(meta.errors.notInGame);
			}

			if (!game.readyPlayers.includes(me.id)) {
				throw new ApiError(meta.errors.notReady);
			}

			if (game.isCountingDown) {
				throw new ApiError(meta.errors.countdownStarted);
			}

			await this.werewolfService.setUnready(ps.gameId, me);
		});
	}
}
