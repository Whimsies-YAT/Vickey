/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import * as argon2 from '@node-rs/argon2';
import { getPasswordHashType } from '@/misc/password-hash-type.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository, UserSessionsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { ApiError } from '../../error.js';
import { Not } from 'typeorm';
import * as Redis from 'ioredis';

export const meta = {
	requireCredential: true,
	secure: true,

	errors: {
		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: 'e5f6g7h8-i9j0-1234-efg0-234567890123',
		},
		authenticationFailed: {
			message: 'Authentication failed.',
			code: 'AUTHENTICATION_FAILED',
			id: 'f6g7h8i9-j0k1-2345-fgh1-345678901234',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string' },
		token: { type: 'string', nullable: true },
	},
	required: ['password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private userAuthService: UserAuthService,
		private userSessionsService: UserSessionsService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers, rawToken) => {
			// Get user profile for password verification
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			// Verify 2FA if enabled
			if (profile.twoFactorEnabled) {
				if (ps.token == null) {
					throw new ApiError(meta.errors.authenticationFailed);
				}

				try {
					await this.userAuthService.twoFactorAuthenticate(profile, ps.token);
				} catch (e) {
					throw new ApiError(meta.errors.authenticationFailed);
				}
			}

			// Verify password
			const hashType = getPasswordHashType(profile.password ?? '');
			const verifyFunctions = {
				'argon2id': () => argon2.verify(profile.password ?? '', ps.password),
				'bcrypt': () => bcrypt.compare(ps.password, profile.password ?? ''),
				'unknown': () => Promise.resolve(false),
			};
			const passwordMatched = await verifyFunctions[hashType]();

			if (!passwordMatched) {
				throw new ApiError(meta.errors.incorrectPassword);
			}

			// Get all sessions except the current one
			const sessions = await this.userSessionsRepository.find({
				where: {
					userId: me.id,
					isActive: true,
					...(rawToken ? { token: Not(rawToken) } : {}),
				},
			});

			if (sessions.length === 0) {
				return {
					success: true,
					deletedCount: 0,
					errors: 0,
				};
			}

			const expiredTime = new Date(Date.now() - 1000);
			const cacheKeys = sessions.map(s => `activeUserSession:${s.token}`);

			await Promise.all([
				this.userSessionsRepository.update(
					{ userId: me.id, isActive: true, ...(rawToken ? { token: Not(rawToken) } : {}) },
					{ isActive: false, expiresAt: expiredTime }
				),
				this.redisClient.del(...cacheKeys)
			]);

			return {
				success: true,
				deletedCount: sessions.length,
				errors: 0,
			};
		});
	}
}
