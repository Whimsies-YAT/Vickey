/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { AccessTokensRepository, AppsRepository, UsersRepository, UserProfilesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiAccessToken } from '@/models/AccessToken.js';
import { MemoryKVCache } from '@/misc/cache.js';
import type { MiApp } from '@/models/App.js';
import { CacheService } from '@/core/CacheService.js';
import { isNativeUserToken } from '@/misc/token.js';
import { bindThis } from '@/decorators.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import type { Config } from '@/config.js';

export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthenticationError';
	}
}

export type AuthenticationResult = {
	user: MiLocalUser | null;
	accessToken: MiAccessToken | null;
	needRefresh?: boolean;
};

@Injectable()
export class AuthenticateService implements OnApplicationShutdown {
	private appCache: MemoryKVCache<MiApp>;

	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		@Inject(DI.config)
		private config: Config,

		private cacheService: CacheService,
		private userSessionsService: UserSessionsService,
	) {
		this.appCache = new MemoryKVCache<MiApp>(1000 * 60 * 60 * 24 * 7); // 1w
	}

	@bindThis
	public async authenticate(token: string | null | undefined, clientIp?: string): Promise<AuthenticationResult> {
		if (token == null) {
			return { user: null, accessToken: null };
		}

		if (isNativeUserToken(token)) {
			if (Date.now() > this.config.nativeTokenExpiry) throw new AuthenticationError('Native token is no longer supported');
			const user = await this.cacheService.localUserByNativeTokenCache.fetch(token,
				async () => {
					const user = await this.usersRepository.findOneBy({ token }) as MiLocalUser | null;
					if (user) {
						const profile = await this.userProfilesRepository.findOneBy({ userId: user.id });
						user.isPasswordSet = profile?.password != null;
					}
					return user;
				});

			if (user == null) {
				throw new AuthenticationError('user not found');
			}

			return { user, accessToken: null };
		}

		const sessionValidation = await this.userSessionsService.validateToken(token, undefined, clientIp);

		if (sessionValidation.isValid && sessionValidation.userId) {
			const user = await this.cacheService.localUserByIdCache.fetch(sessionValidation.userId,
				async () => {
					const user = await this.usersRepository.findOneBy({
						id: sessionValidation.userId,
					}) as MiLocalUser;
					if (user) {
						const profile = await this.userProfilesRepository.findOneBy({ userId: user.id });
						user.isPasswordSet = profile?.password != null;
					}
					return user;
				});

			if (user == null) {
				throw new AuthenticationError('user not found');
			}

			return {
				user,
				accessToken: null,
				needRefresh: sessionValidation.needRefresh,
			};
		}

		const accessToken = await this.accessTokensRepository.findOne({
			where: [{
				hash: token.toLowerCase(),
			}, {
				token: token,
			}],
		});

		if (accessToken != null) {
			if (accessToken.lastUsedAt == null || Date.now() - accessToken.lastUsedAt.getTime() > 30 * 1000) {
				await this.accessTokensRepository.update(accessToken.id, {
					lastUsedAt: new Date(),
				});
			}

			const user = await this.cacheService.localUserByIdCache.fetch(accessToken.userId,
				async () => {
					const user = await this.usersRepository.findOneBy({
						id: accessToken.userId,
					}) as MiLocalUser;
					if (user) {
						const profile = await this.userProfilesRepository.findOneBy({ userId: user.id });
						user.isPasswordSet = profile?.password != null;
					}
					return user;
				});

			if (accessToken.appId) {
				const app = await this.appCache.fetch(accessToken.appId,
					() => this.appsRepository.findOneByOrFail({ id: accessToken.appId! }));

				return {
					user,
					accessToken: {
						id: accessToken.id,
						permission: app.permission,
					} as MiAccessToken,
				};
			} else {
				return { user, accessToken };
			}
		}

		throw new AuthenticationError('invalid signature');
	}

	@bindThis
	public dispose(): void {
		this.appCache.dispose();
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
