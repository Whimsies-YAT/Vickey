/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository, UserProfilesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiUserProfile } from '@/models/UserProfile.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { OAuthClientService, type OAuthClientConfig, type TokenResponse } from './OAuthClientService.js';
import { OIDCClientService, type IDTokenClaims } from './OIDCClientService.js';
import type { UserInfo } from './OAuthClientService.js';

export interface SSOProvider {
	id: string;
	name: string;
	type: 'oauth2' | 'oidc';
	config: OAuthClientConfig;
	autoRegister?: boolean;
	autoUpdate?: boolean;
	userMapping?: {
		username?: string;
		email?: string;
		name?: string;
		avatar?: string;
	};
}

export interface SSOSession {
	providerId: string;
	state: string;
	userId?: string;
	userInfo?: UserInfo;
	idTokenClaims?: IDTokenClaims;
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	createdAt: number;
}

export interface SSOLoginResult {
	user: MiLocalUser;
	isNewUser: boolean;
	session: SSOSession;
	action: 'login' | 'link';
}

@Injectable()
export class SSOService {
	private readonly logger: Logger;
	private readonly providers = new Map<string, SSOProvider>();
	private readonly pendingStates = new Map<string, { providerId: string; createdAt: number; userId?: string }>();

	constructor(
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private readonly userProfilesRepository: UserProfilesRepository,

		private readonly loggerService: LoggerService,
		private readonly idService: IdService,
		private readonly oauthClientService: OAuthClientService,
		private readonly oidcClientService: OIDCClientService,
		private readonly metaService: MetaService,
	) {
		this.logger = this.loggerService.getLogger('sso');
	}

	/**
	 * Register SSO provider
	 */
	@bindThis
	public registerProvider(provider: SSOProvider): void {
		this.providers.set(provider.id, provider);
		this.logger.info(`Registered SSO provider: ${provider.name} (${provider.type})`);
	}

	/**
	 * Unregister SSO provider
	 */
	@bindThis
	public unregisterProvider(id: string): void {
		if (this.providers.has(id)) {
			const provider = this.providers.get(id);
			this.providers.delete(id);
			this.logger.info(`Unregistered SSO provider: ${provider?.name}`);
		}
	}

	/**
	 * Get all registered providers
	 */
	@bindThis
	public getProviders(): SSOProvider[] {
		return Array.from(this.providers.values());
	}

	/**
	 * Get provider by ID
	 */
	@bindThis
	public getProvider(id: string): SSOProvider | undefined {
		return this.providers.get(id);
	}

	/**
	 * Clean up expired pending states
	 */
	@bindThis
	private cleanupExpiredStates(): void {
		const now = Date.now();
		const expiredStates: string[] = [];

		for (const [state, data] of this.pendingStates.entries()) {
			if (now - data.createdAt > 1000 * 60 * 10) { // 10 minutes
				expiredStates.push(state);
			}
		}

		for (const state of expiredStates) {
			this.pendingStates.delete(state);
		}
	}

	/**
	 * Initialize SSO login
	 */
	@bindThis
	public async initializeLogin(providerId: string, userId?: string): Promise<{ authUrl: string; state: string }> {
		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new Error(`SSO provider not found: ${providerId}`);
		}

		const authRequest = await this.oauthClientService.generateAuthorizationUrl(provider.config);

		this.pendingStates.set(authRequest.state, {
			providerId,
			createdAt: Date.now(),
			userId,
		});

		// Clean up expired states (older than 10 minutes)
		this.cleanupExpiredStates();

		return {
			authUrl: authRequest.authUrl,
			state: authRequest.state,
		};
	}

	/**
	 * Complete SSO login
	 */
	@bindThis
	public async completeLogin(code: string, state: string): Promise<SSOLoginResult> {
		// Retrieve and validate state
		const stateData = this.pendingStates.get(state);
		if (!stateData || !stateData.providerId) {
			throw new Error('Invalid state parameter');
		}

		// Check if state is expired (10 minutes)
		if (Date.now() - stateData.createdAt > 1000 * 60 * 10) {
			this.pendingStates.delete(state);
			throw new Error('State parameter expired');
		}

		const providerId = stateData.providerId;
		this.pendingStates.delete(state);

		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new Error(`SSO provider not found: ${stateData.providerId}`);
		}

		let userInfo: UserInfo;
		let idTokenClaims: IDTokenClaims | undefined;
		let tokenResponse: TokenResponse;

		if (provider.type === 'oidc') {
			const authResult = await this.oidcClientService.authenticate(code, state);
			userInfo = authResult.userInfo;
			idTokenClaims = authResult.idTokenClaims;
			tokenResponse = authResult.tokenResponse;
		} else {
			tokenResponse = await this.oauthClientService.exchangeCodeForToken(code, state);
			userInfo = await this.oauthClientService.getUserInfo(provider.config, tokenResponse.access_token);
		}

		// Find or create user
		const { user, isNewUser, action } = await this.findOrCreateUser(provider, userInfo, idTokenClaims, stateData.userId);

		// Create SSO session
		const session: SSOSession = {
			providerId: provider.id,
			state,
			userId: user.id,
			userInfo,
			idTokenClaims,
			accessToken: tokenResponse.access_token,
			refreshToken: tokenResponse.refresh_token,
			expiresAt: tokenResponse.expires_in ? Date.now() + (tokenResponse.expires_in * 1000) : undefined,
			createdAt: Date.now(),
		};

		return { user, isNewUser, session, action };
	}

	/**
	 * Find existing user or create new one
	 */
	@bindThis
	private async findOrCreateUser(
		provider: SSOProvider,
		userInfo: UserInfo,
		idTokenClaims?: IDTokenClaims,
		targetUserId?: string,
	): Promise<{ user: MiLocalUser; isNewUser: boolean; action: 'login' | 'link' }> {
		const ssoId = userInfo.sub;
		const email = userInfo.email;

		const userProfile = await this.userProfilesRepository.findOne({
			where: {
				ssoProviderId: provider.id,
				ssoId: ssoId,
			},
			relations: ['user'],
		});

		const user = userProfile?.user as MiLocalUser | null;

		if (targetUserId) {
			if (user) {
				if (user.id === targetUserId) {
					if (provider.autoUpdate) {
						await this.updateUserInfo(user, userProfile!, provider, userInfo, idTokenClaims);
					}
					return { user, isNewUser: false, action: 'link' };
				} else {
					throw new Error('This account is already linked to another user.');
				}
			} else {
				const targetProfile = await this.userProfilesRepository.findOneBy({ userId: targetUserId });
				if (!targetProfile) {
					throw new Error('Target user profile not found.');
				}

				let emailToUpdate: string | undefined;
				let emailVerifiedToUpdate: boolean | undefined;

				if (!targetProfile.emailVerified && email) {
					const emailProfile = await this.userProfilesRepository.findOne({
						where: { email },
						relations: ['user'],
					});
					const emailUser = emailProfile?.user as MiLocalUser | null;

					if (emailUser && emailUser.id !== targetUserId) {
						this.logger.warn(`Email address ${email} is already used by another user ${emailUser.id}. Skipping email update for user ${targetUserId}.`);
					} else {
						emailToUpdate = email;
						emailVerifiedToUpdate = userInfo.email_verified;
					}
				}

				await this.userProfilesRepository.update(targetUserId, {
					ssoProviderId: provider.id,
					ssoId: ssoId,
					email: emailToUpdate || targetProfile.email,
					emailVerified: emailVerifiedToUpdate ?? targetProfile.emailVerified,
				});

				const targetUser = await this.usersRepository.findOneByOrFail({ id: targetUserId }) as MiLocalUser;
				return { user: targetUser, isNewUser: false, action: 'link' };
			}
		}

		if (user && userProfile) {
			if (provider.autoUpdate) {
				await this.updateUserInfo(user, userProfile, provider, userInfo, idTokenClaims);
			}
			return { user, isNewUser: false, action: 'login' };
		}

		// FIXME: Temporarily disabled
		/*
		if (!provider.autoRegister) {
			throw new Error('User not found and auto-registration is disabled');
		}

		return await this.createUser(provider, userInfo, idTokenClaims);
		*/
		throw new Error('New user registration via SSO is temporarily disabled.');
	}

	/**
	 * Create new user from SSO info
	 */
	@bindThis
	private async createUser(
		provider: SSOProvider,
		userInfo: UserInfo,
		idTokenClaims?: IDTokenClaims,
	): Promise<{ user: MiLocalUser; isNewUser: boolean; action: 'login' | 'link' }> {
		const userId = this.idService.gen();
		const username = this.generateUsername(provider, userInfo, idTokenClaims);
		const name = this.extractName(provider, userInfo, idTokenClaims);

		const meta = await this.metaService.fetch();
		if (meta.approvalRequiredForSignup && meta.rootUserId) {
			throw new Error('New registrations are currently suspended.');
		}

		const user = await this.usersRepository.insert({
			id: userId,
			username,
			name,
			host: null,
			isBot: false,
			isLocked: false,
			isExplorable: true,
			isDeleted: false,
			isSuspended: false,
		}).then(result => result.generatedMaps[0] as MiLocalUser);

		await this.userProfilesRepository.insert({
			userId: user.id,
			ssoProviderId: provider.id,
			ssoId: userInfo.sub,
			email: userInfo.email,
			emailVerified: userInfo.email_verified,
		});

		const fullUser = user as MiLocalUser;

		this.logger.info(`Created new user via SSO: ${username} (${provider.name})`);

		return { user: fullUser, isNewUser: true, action: 'login' };
	}

	/**
	 * Update existing user info
	 */
	@bindThis
	private async updateUserInfo(
		user: MiLocalUser,
		userProfile: MiUserProfile,
		provider: SSOProvider,
		userInfo: UserInfo,
		idTokenClaims?: IDTokenClaims,
	): Promise<void> {
		const name = this.extractName(provider, userInfo, idTokenClaims);

		const updates: Partial<MiLocalUser> = {};
		if (name && !user.name) {
			updates.name = name;
		}

		if (Object.keys(updates).length > 0) {
			await this.usersRepository.update(user.id, updates);
		}

		// Update profile
		const profileUpdates: Partial<MiUserProfile> = {};
		if (userInfo.email && userInfo.email !== userProfile.email) {
			profileUpdates.email = userInfo.email;
			profileUpdates.emailVerified = userInfo.email_verified;
		}

		if (Object.keys(profileUpdates).length > 0) {
			await this.userProfilesRepository.update(userProfile.userId, profileUpdates);
		}
	}

	/**
	 * Generate username from user info
	 */
	@bindThis
	private generateUsername(
		provider: SSOProvider,
		userInfo: UserInfo,
		idTokenClaims?: IDTokenClaims,
	): string {
		const mapping = provider.userMapping?.username;
		let username: string;

		if (mapping) {
			username = this.extractField(userInfo, idTokenClaims, mapping) || userInfo.preferred_username || userInfo.name || userInfo.sub;
		} else {
			username = userInfo.preferred_username || userInfo.name || userInfo.sub;
		}

		// Sanitize username
		username = username.toLowerCase()
			.replace(/[^a-z0-9_]/g, '')
			.substring(0, 32);

		if (!username) {
			username = `user_${userInfo.sub.substring(0, 8)}`;
		}

		return username;
	}

	/**
	 * Extract name from user info
	 */
	@bindThis
	private extractName(
		provider: SSOProvider,
		userInfo: UserInfo,
		idTokenClaims?: IDTokenClaims,
	): string {
		const mapping = provider.userMapping?.name;

		if (mapping) {
			return this.extractField(userInfo, idTokenClaims, mapping) || userInfo.name || userInfo.preferred_username || '';
		}

		return userInfo.name || userInfo.preferred_username || '';
	}

	/**
	 * Extract field from user info using mapping
	 */
	@bindThis
	private extractField(
		userInfo: UserInfo,
		idTokenClaims: IDTokenClaims | undefined,
		fieldPath: string,
	): string | undefined {
		const sources = [userInfo, idTokenClaims].filter(Boolean);

		for (const source of sources) {
			const value = this.getNestedProperty(source, fieldPath);
			if (value && typeof value === 'string') {
				return value;
			}
		}

		return undefined;
	}

	/**
	 * Get nested property from object
	 */
	@bindThis
	private getNestedProperty(obj: any, path: string): any {
		return path.split('.').reduce((current, key) => current?.[key], obj);
	}

	/**
	 * Get SSO session for user
	 */
	@bindThis
	public async getSession(_userId: string, _providerId: string): Promise<SSOSession | null> {
		return null;
	}

	/**
	 * Refresh SSO session tokens
	 */
	@bindThis
	public async refreshSession(userId: string, providerId: string): Promise<SSOSession | null> {
		const session = await this.getSession(userId, providerId);
		if (!session || !session.refreshToken) {
			return null;
		}

		const provider = this.providers.get(providerId);
		if (!provider) {
			return null;
		}

		try {
			const tokenResponse = await this.oauthClientService.refreshToken(
				provider.config,
				session.refreshToken,
			);

			// Update session
			session.accessToken = tokenResponse.access_token;
			session.refreshToken = tokenResponse.refresh_token || session.refreshToken;
			session.expiresAt = tokenResponse.expires_in ? Date.now() + (tokenResponse.expires_in * 1000) : undefined;

			return session;
		} catch (error) {
			this.logger.error('Failed to refresh SSO session', { userId, providerId, error });
			return null;
		}
	}

	/**
	 * Logout SSO session
	 */
	@bindThis
	public async logout(userId: string, providerId: string): Promise<void> {
		const session = await this.getSession(userId, providerId);
		if (!session) {
			return;
		}

		const provider = this.providers.get(providerId);
		if (provider && session.accessToken) {
			try {
				await this.oauthClientService.revokeToken(provider.config, session.accessToken, 'access_token');
			} catch (error) {
				this.logger.error('Failed to revoke access token', { userId, providerId, error });
			}

			if (session.refreshToken) {
				try {
					await this.oauthClientService.revokeToken(provider.config, session.refreshToken, 'refresh_token');
				} catch (error) {
					this.logger.error('Failed to revoke refresh token', { userId, providerId, error });
				}
			}
		}
	}
}
