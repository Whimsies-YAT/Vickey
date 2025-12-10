/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as argon2 from '@node-rs/argon2';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	requireCredential: true,

	secure: true,

	kind: 'write:account',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string', minLength: 8 },
	},
	required: ['password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.config)
		private config: Config,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			if (profile.password != null) {
				throw new ApiError({
					message: 'Password already set.',
					code: 'PASSWORD_ALREADY_SET',
					id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
				});
			}

			const hash = await argon2.hash(ps.password, this.config.argon2Config || {
				memoryCost: 4096,
				timeCost: 3,
				parallelism: 1,
				outputLen: 32,
			});

			await this.userProfilesRepository.update(me.id, {
				password: hash,
			});
		});
	}
}
