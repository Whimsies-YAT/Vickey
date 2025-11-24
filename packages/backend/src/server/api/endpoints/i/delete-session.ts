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
import * as Redis from 'ioredis';

export const meta = {
	requireCredential: true,
	secure: true,

	errors: {
		sessionNotFound: {
			message: 'Session not found.',
			code: 'SESSION_NOT_FOUND',
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
		},
		cannotDeleteCurrentSession: {
			message: 'Cannot delete current session.',
			code: 'CANNOT_DELETE_CURRENT_SESSION',
			id: 'b2c3d4e5-f6g7-8901-bcde-f12345678901',
		},
		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: 'c3d4e5f6-g7h8-9012-cdef-012345678901',
		},
		authenticationFailed: {
			message: 'Authentication failed.',
			code: 'AUTHENTICATION_FAILED',
			id: 'd4e5f6g7-h8i9-0123-def0-123456789012',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sessionId: { type: 'string', format: 'misskey:id' },
		password: { type: 'string' },
		token: { type: 'string', nullable: true },
	},
	required: ['sessionId', 'password'],
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

			// Find the session to delete
			const session = await this.userSessionsRepository.findOne({
				where: {
					id: ps.sessionId,
					userId: me.id,
					isActive: true,
				},
			});

			if (!session) {
				throw new ApiError(meta.errors.sessionNotFound);
			}

			// Prevent deleting current session
			if (rawToken && session.token === rawToken) {
				throw new ApiError(meta.errors.cannotDeleteCurrentSession);
			}

			const expiredTime = new Date(Date.now() - 1000);
			await Promise.all([
				this.userSessionsRepository.update(
					{ id: ps.sessionId, userId: me.id, isActive: true },
					{ isActive: false, expiresAt: expiredTime }
				),
				this.redisClient.del(`activeUserSession:${session.token}`)
			]);

			return {
				success: true,
			};
		});
	}
}
