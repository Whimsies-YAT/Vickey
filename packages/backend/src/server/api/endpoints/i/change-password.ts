/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import * as argon2 from '@node-rs/argon2';
import { getPasswordHashType } from '@/misc/password-hash-type.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { UserAuthService } from '@/core/UserAuthService.js';

export const meta = {
	requireCredential: true,

	secure: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		currentPassword: { type: 'string' },
		newPassword: { type: 'string', minLength: 8 },
		token: { type: 'string', nullable: true },
	},
	required: ['currentPassword', 'newPassword'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.config)
		private config: Config,

		private userAuthService: UserAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const token = ps.token;
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			if (profile.twoFactorEnabled) {
				if (token == null) {
					throw new Error('authentication failed');
				}

				try {
					await this.userAuthService.twoFactorAuthenticate(profile, token);
				} catch (_) {
					throw new Error('authentication failed');
				}
			}

			// Verify current password
			const hashType = getPasswordHashType(profile.password ?? '');
			const verifyFunctions = {
				'argon2id': () => argon2.verify(profile.password ?? '', ps.currentPassword),
				'bcrypt': async () => {
					const isValid = await bcrypt.compare(ps.currentPassword, profile.password ?? '');
					if (isValid) {
						// Upgrade bcrypt to Argon2id
						const newHash = await argon2.hash(ps.currentPassword, this.config.argon2Config || {
							memoryCost: 4096,
							timeCost: 3,
							parallelism: 1,
							outputLen: 32,
						});
						await this.userProfilesRepository.update(me.id, { password: newHash });
					}
					return isValid;
				},
				'unknown': () => Promise.resolve(false)
			};
			const passwordMatched = await verifyFunctions[hashType]();

			if (!passwordMatched) {
				throw new Error('incorrect password');
			}

			// Generate hash of new password using Argon2id
			const hash = await argon2.hash(ps.newPassword, this.config.argon2Config || {
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
