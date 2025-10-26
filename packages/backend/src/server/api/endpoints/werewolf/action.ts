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
			id: 'q7rl1n6s5-8o0p-7r2q-1n9s-5p8r0q1s2m4o',
		},

		notStarted: {
			message: 'Game has not started.',
			code: 'NOT_STARTED',
			id: 'r8sm2o7t6-9p1q-8s3r-2o0t-6q9s1r2t3n5p',
		},

		gameEnded: {
			message: 'Game has ended.',
			code: 'GAME_ENDED',
			id: 's9tn3p8u7-0q2r-9t4s-3p1u-7r0t2s3u4o6q',
		},

		notJoined: {
			message: 'You have not joined this game.',
			code: 'NOT_JOINED',
			id: 't0uo4q9v8-1r3s-0u5t-4q2v-8s1u3t4v5p7r',
		},

		notAlive: {
			message: 'You are not alive.',
			code: 'NOT_ALIVE',
			id: 'u1vp5r0w9-2s4t-1v6u-5r3w-9t2v4u5w6q8s',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
		action: { type: 'string' },
		target: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['gameId', 'action'],
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

			if (!game.isStarted) {
				throw new ApiError(meta.errors.notStarted);
			}

			if (game.isEnded) {
				throw new ApiError(meta.errors.gameEnded);
			}

			const player = game.players.find(p => p.userId === me.id);
			if (!player) {
				throw new ApiError(meta.errors.notJoined);
			}

			if (!player.isAlive) {
				throw new ApiError(meta.errors.notAlive);
			}

			const success = await this.werewolfService.performAction(ps.gameId, me, ps.action, ps.target ?? undefined);

			if (!success) {
				throw new ApiError(meta.errors.noSuchGame);
			}
		});
	}
}
