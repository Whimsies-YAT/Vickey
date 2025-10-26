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
			id: 'f6ga0c5h4-7d9e-6g1f-0c8h-4e7g9f0h1b3d',
		},

		alreadyStarted: {
			message: 'Game has already started.',
			code: 'ALREADY_STARTED',
			id: 'g7hb1d6i5-8e0f-7h2g-1d9i-5f8h0g1i2c4e',
		},

		notJoined: {
			message: 'You have not joined this game.',
			code: 'NOT_JOINED',
			id: 'h8ic2e7j6-9f1g-8i3h-2e0j-6g9i1h2j3d5f',
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

			if (!game.players.some(p => p.userId === me.id)) {
				throw new ApiError(meta.errors.notJoined);
			}

			const success = await this.werewolfService.leaveGame(ps.gameId, me);

			if (!success) {
				throw new ApiError(meta.errors.noSuchGame);
			}
		});
	}
}
