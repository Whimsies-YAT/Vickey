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
		message: { type: 'string', minLength: 1, maxLength: 500 },
		channelType: { type: 'string', enum: ['game', 'dead'] },
	},
	required: ['gameId', 'message', 'channelType'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private werewolfService: WerewolfService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.werewolfService.sendMessage(ps.gameId, me, ps.message, ps.channelType);
		});
	}
}
