/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfGameEntityService } from '@/core/entities/WerewolfGameEntityService.js';

export const meta = {
	requireCredential: true,
	secure: true,

	kind: 'write:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'WerewolfGameDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		mode: { type: 'string', enum: ['preset_6', 'preset_9', 'custom'] },
	},
	required: ['mode'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private werewolfService: WerewolfService,
		private werewolfGameEntityService: WerewolfGameEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const game = await this.werewolfService.createGame(me, ps.mode);

			return await this.werewolfGameEntityService.packDetail(game);
		});
	}
}
