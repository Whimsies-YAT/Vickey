/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfGameEntityService } from '@/core/entities/WerewolfGameEntityService.js';
import { ApiError } from '../../error.js';

export const meta = {
	requireCredential: false,
	secure: true,

	errors: {
		noSuchGame: {
			message: 'No such game.',
			code: 'NO_SUCH_GAME',
			id: 'v2wq6s1x0-3t5u-2w7v-6s4x-0u3w5v6x7r9t',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'WerewolfGameDetailed',
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
		private werewolfGameEntityService: WerewolfGameEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const game = await this.werewolfService.get(ps.gameId);

			if (game == null) {
				throw new ApiError(meta.errors.noSuchGame);
			}

			const packed = await this.werewolfGameEntityService.packDetail(game);

			// Add role-specific UI state if user is playing
			if (me) {
				const roleState = this.werewolfService.getRoleUiState(game, me.id);
				return {
					...packed,
					myRoleState: roleState,
				};
			}

			return packed;
		});
	}
}
