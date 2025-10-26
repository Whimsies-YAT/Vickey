/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfService } from '@/core/WerewolfService.js';

export const meta = {
	tags: ['werewolf'],
	requireCredential: true,
	secure: true,
	errors: {
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameId: { type: 'string', format: 'misskey:id' },
		seatNumber: { type: 'integer', minimum: 0, maximum: 11 },
	},
	required: ['gameId', 'seatNumber'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private werewolfService: WerewolfService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.werewolfService.takeSeat(ps.gameId, me, ps.seatNumber);
		});
	}
}
