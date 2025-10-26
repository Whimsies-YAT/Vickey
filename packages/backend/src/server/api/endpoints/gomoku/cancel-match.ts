/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GomokuService } from '@/core/GomokuService.js';

export const meta = {
	requireCredential: true,

	kind: 'write:account',

	errors: {
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private gomokuService: GomokuService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userId) {
				await this.gomokuService.matchSpecificUserCancel(me, ps.userId);
				return;
			} else {
				await this.gomokuService.matchAnyUserCancel(me);
			}
		});
	}
}
