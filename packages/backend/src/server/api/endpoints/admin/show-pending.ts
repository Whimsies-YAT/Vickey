/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserPendingsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:show-pendings',

	res: {
		type: 'object',
		nullable: false, optional: false,
		properties: {
			email: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const [PendingUser] = await Promise.all([
				this.userPendingsRepository.findOneBy({ id: ps.id }),
			]);

			if (PendingUser == null) {
				throw new Error('user not found');
			}

			return {
				username: PendingUser.username,
				email: PendingUser.email,
				approved: false,
				signupReason: PendingUser.reason,
			};
		});
	}
}
