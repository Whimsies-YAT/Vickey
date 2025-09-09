/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import * as argon2 from '@node-rs/argon2';
import { getPasswordHashType } from '@/misc/password-hash-type.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository, UserProfilesRepository, SigninsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { DI } from '@/di-symbols.js';
import { isNativeUserToken, generateDeviceId } from '@/misc/token.js';
import { IsNull, Not } from "typeorm";
import { IdService } from '@/core/IdService.js';
import { detectDeviceType } from '@/misc/device-type.js';

export const meta = {
	requireCredential: true,

	secure: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string', nullable: true },
		current: { type: 'boolean', nullable: true, default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private globalEventService: GlobalEventService,
		private userSessionsService: UserSessionsService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers, rawToken) => {
			const freshUser = await this.usersRepository.findOneByOrFail({ id: me.id });
			const oldToken = freshUser.token!;

			let forceCurrentOnly = false;
			let currentSignInId: string | undefined = undefined;
			let currentDeviceId: string | undefined = undefined;
			let signInHistory: any = null;
			let inheritedDeviceId: string | undefined = undefined;
			let inheritedIp: Array<{ address: string; count: number; lastSeen: Date }> | undefined = undefined;

			if (rawToken) {
				try {
					const currentTokenValidation = await this.userSessionsService.validateToken(rawToken, me.id, ip ?? undefined);
					if (currentTokenValidation.isValid) {
						inheritedDeviceId = currentTokenValidation.deviceId;
						inheritedIp = currentTokenValidation.ip || undefined;
					}
				} catch (error) {}
			}

			if (rawToken && !ps.password) {
				if (isNativeUserToken(rawToken)) {
					const user = await this.usersRepository.findOneBy({ id: me.id, token: rawToken });
					if (!user) {
						throw new Error('invalid token');
					}

					try {
						const currentDeviceType = detectDeviceType(headers);
						const userAgent = headers?.['user-agent'] || headers?.['User-Agent'] || '';

						const recentSignIn = await this.signinsRepository.createQueryBuilder('signin')
							.where('signin.userId = :userId', { userId: me.id })
							.andWhere('signin.success = true')
							.andWhere('signin.headers::text LIKE :userAgent', { userAgent: `%${userAgent.slice(0, 100)}%` })
							.orderBy('signin.id', 'DESC')
							.getOne();

						if (recentSignIn) {
							currentSignInId = recentSignIn.id;
							currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
						} else {
							const id = this.idService.gen();
							signInHistory = await this.signinsRepository.insertOne({
								id,
								userId: me.id,
								ip: ip || '127.0.0.1',
								headers: headers as any,
								success: true,
							});
							currentSignInId = signInHistory.id;
							currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
						}
					} catch (error) {
						const currentDeviceType = detectDeviceType(headers);
						const id = this.idService.gen();
						signInHistory = await this.signinsRepository.insertOne({
							id,
							userId: me.id,
							ip: ip || '127.0.0.1',
							headers: headers as any,
							success: true,
						});
						currentSignInId = signInHistory.id;
						currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
					}
				} else {
					const validation = await this.userSessionsService.validateToken(rawToken, me.id, ip ?? undefined);
					if (!validation.isValid || validation.userId !== me.id) {
						throw new Error('invalid token');
					}

					currentSignInId = validation.signInId || undefined;
					currentDeviceId = validation.deviceId || undefined;
					inheritedIp = validation.ip || undefined;
				}
				forceCurrentOnly = true;
			} else if (ps.password) {
				const password = ps.password as string;
				const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

				const hashType = getPasswordHashType(profile.password!);
				const verifyFunctions = {
					'argon2id': () => argon2.verify(profile.password!, password),
					'bcrypt': async () => {
						const isValid = await bcrypt.compare(password, profile.password!);
						if (isValid) {
							// Upgrade bcrypt to Argon2id
							const newHash = await argon2.hash(password, this.config.argon2Config || {
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
				const same = await verifyFunctions[hashType]();
				if (!same) {
					throw new Error('incorrect password');
				}

				try {
					const currentDeviceType = detectDeviceType(headers);
					const userAgent = headers?.['user-agent'] || headers?.['User-Agent'] || '';

					const recentSignIn = await this.signinsRepository.createQueryBuilder('signin')
						.where('signin.userId = :userId', { userId: me.id })
						.andWhere('signin.success = true')
						.andWhere('signin.headers::text LIKE :userAgent', { userAgent: `%${userAgent.slice(0, 100)}%` })
						.orderBy('signin.id', 'DESC')
						.getOne();

					if (recentSignIn) {
						currentSignInId = recentSignIn.id;
						currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
					} else {
						const id = this.idService.gen();
						const newSignIn = await this.signinsRepository.insertOne({
							id,
							userId: me.id,
							ip: ip || '127.0.0.1',
							headers: headers as any,
							success: true,
						});
						currentSignInId = newSignIn.id;
						currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
					}
				} catch (error) {
					const currentDeviceType = detectDeviceType(headers);
					const id = this.idService.gen();
					const newSignIn = await this.signinsRepository.insertOne({
						id,
						userId: me.id,
						ip: ip || '127.0.0.1',
						headers: headers as any,
						success: true,
					});
					currentSignInId = newSignIn.id;
					currentDeviceId = inheritedDeviceId || generateDeviceId(currentDeviceType);
				}
			} else {
				throw new Error('password required');
			}

			if (!oldToken || !isNativeUserToken(oldToken)) {
				const shouldInvalidateCurrentOnly = forceCurrentOnly || ps.current;

				if (!shouldInvalidateCurrentOnly) {
					await this.userSessionsService.invalidateTokenSafely(me.id);
				} else if (rawToken) {
					await this.userSessionsService.invalidateTokenSafely(me.id, rawToken);
				} else {
					await this.userSessionsService.invalidateTokenSafely(me.id, oldToken);
				}
			}

			const newToken = await this.userSessionsService.createTokenSafely({
				userId: me.id,
				signInId: currentSignInId,
				deviceId: currentDeviceId,
				clientIp: ip ?? undefined,
				inheritedIp: inheritedIp,
			} as any);

			if (!newToken) {
				throw new Error('Failed to create new session token');
			}

			await this.usersRepository.update(
				{ id: me.id, token: Not(IsNull()) },
				{ token: null }
			);

			if (oldToken && isNativeUserToken(oldToken)) {
				this.globalEventService.publishInternalEvent('userTokenRegenerated', { id: me.id, oldToken, newToken });
			}

			this.globalEventService.publishMainStream(me.id, 'myTokenRegenerated');

			return {
				token: newToken,
			};
		});
	}
}
