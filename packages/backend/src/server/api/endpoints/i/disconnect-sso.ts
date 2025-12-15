/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import * as argon2 from '@node-rs/argon2';
import { Inject, Injectable } from '@nestjs/common';
import { getPasswordHashType } from '@/misc/password-hash-type.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'write:account',

	res: {
		type: 'object',
	},

	errors: {
		passwordRequired: {
			message: 'Password required.',
			code: 'PASSWORD_REQUIRED',
			id: '12513470-8041-4c6f-9988-51f71a06708b',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: {
			type: 'string',
		},
		token: {
			type: 'string',
			nullable: true,
		},
	},
	required: ['password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userAuthService: UserAuthService,
	) {
		super(meta, paramDef, async (ps, user) => {
			const token = ps.token;
			const userProfile = await this.userProfilesRepository.findOneBy({ userId: user.id });

			if (!userProfile) return;

			if (userProfile.twoFactorEnabled) {
				if (token == null) {
					throw new ApiError({
						message: '2FA authentication failed.',
						code: 'AUTHENTICATION_FAILED',
						id: 'disconnect-sso-2fa-failed',
					});
				}

				try {
					await this.userAuthService.twoFactorAuthenticate(userProfile, token);
				} catch (e) {
					throw new ApiError({
						message: '2FA authentication failed.',
						code: 'AUTHENTICATION_FAILED',
						id: 'disconnect-sso-2fa-failed',
					});
				}
			}

			if (userProfile.ssoProviderId == null) return;

			if (userProfile.password == null) {
				throw new ApiError({
					message: 'You must set a password before disconnecting your SSO account.',
					code: 'NO_PASSWORD_SET',
					id: 'disconnect-sso-no-password',
				});
			}

			if (ps.password == null) {
				throw new ApiError(meta.errors.passwordRequired);
			}

			const hashType = getPasswordHashType(userProfile.password);
			const verifyFunctions = {
				'argon2id': () => argon2.verify(userProfile.password!, ps.password!),
				'bcrypt': async () => {
					const isValid = await bcrypt.compare(ps.password!, userProfile.password!);
					if (isValid) {
						const newHash = await argon2.hash(ps.password!, this.config.argon2Config || {
							memoryCost: 4096,
							timeCost: 3,
							parallelism: 1,
							outputLen: 32,
						});
						await this.userProfilesRepository.update(user.id, { password: newHash });
					}
					return isValid;
				},
				'unknown': () => Promise.resolve(false),
			};

			const passwordMatched = await verifyFunctions[hashType]();
			if (!passwordMatched) {
				throw new ApiError({
					message: 'Incorrect password.',
					code: 'INCORRECT_PASSWORD',
					id: 'disconnect-sso-incorrect-password',
				});
			}

			await this.userProfilesRepository.update(user.id, {
				ssoProviderId: null,
				ssoId: null,
			});
		});
	}
}
