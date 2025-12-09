/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import type { MiLocalUser } from '@/models/User.js';
import { OAuthClientService } from './OAuthClientService.js';
import { OIDCClientService } from './OIDCClientService.js';
import { SSOService } from './SSOService.js';
import { JWTService } from './JWTService.js';
import { OAuthClientConfigService } from './OAuthClientConfigService.js';
import { SessionService } from './SessionService.js';
import type {
	SSOProvider,
	SSOLoginResult,
} from './SSOService.js';

export interface UserSessionApiResult {
	sessionId: string;
	providerName: string;
	// UserInfo fields can be null
	userInfo: {
		name?: string | null;
		email?: string | null;
		picture?: string | null;
	};
	createdAt: Date;
	lastUsedAt: Date;
	ipAddress?: string | null;
	userAgent?: string | null;
	isExpired: boolean;
}

/**
 * Comprehensive OAuth Client Manager
 * Provides high-level API for OAuth 2.0 / OIDC / SSO functionality
 */
@Injectable()
export class OAuthClientManager implements OnModuleInit {
	private readonly logger: Logger;

	constructor(
		private readonly loggerService: LoggerService,
		private readonly oauthClientService: OAuthClientService,
		private readonly oidcClientService: OIDCClientService,
		private readonly ssoService: SSOService,
		private readonly jwtService: JWTService,
		private readonly oauthClientConfigService: OAuthClientConfigService,
		private readonly sessionService: SessionService,
	) {
		this.logger = this.loggerService.getLogger('oauth-client-manager');
	}

	async onModuleInit() {
		await this.initializeProviders();
		this.scheduleCleanupTasks();
	}

	/**
	 * Initialize SSO providers from database configurations
	 */
	@bindThis
	private async initializeProviders(): Promise<void> {
		try {
			this.logger.info('OAuth Client Manager initialized');
		} catch (error) {
			this.logger.error('Failed to initialize OAuth providers', { error });
		}
	}

	/**
	 * Schedule cleanup tasks
	 */
	@bindThis
	private scheduleCleanupTasks(): void {
		// Clean up expired sessions every hour
		setInterval(async () => {
			try {
				await this.sessionService.cleanupExpiredSessions();
			} catch (error) {
				this.logger.error('Failed to cleanup expired sessions', { error });
			}
		}, 1000 * 60 * 60); // 1 hour
	}

	/**
	 * Register SSO provider from user configuration
	 */
	@bindThis
	public async registerProvider(userId: string, configId: string): Promise<void> {
		const config = await this.oauthClientConfigService.get(configId, userId);
		if (!config || !config.isActive) {
			throw new Error('OAuth client configuration not found or inactive');
		}

		const provider = this.oauthClientConfigService.toSSOProvider(config);
		this.ssoService.registerProvider(provider);

		this.logger.info(`Registered SSO provider: ${provider.name} for user ${userId}`);
	}

	/**
	 * Get available SSO providers
	 */
	@bindThis
	public getAvailableProviders(): SSOProvider[] {
		return this.ssoService.getProviders();
	}

	/**
	 * Initialize SSO login flow
	 */
	@bindThis
	public async startSSOLogin(providerId: string, userId?: string): Promise<{ authUrl: string; state: string }> {
		return await this.ssoService.initializeLogin(providerId, userId);
	}

	/**
	 * Complete SSO login flow
	 */
	@bindThis
	public async completeSSOLogin(
		code: string,
		state: string,
		ipAddress?: string,
		userAgent?: string,
	): Promise<{
			user: MiLocalUser;
			sessionId: string;
			isNewUser: boolean;
			action: 'login' | 'link';
		}> {
		const loginResult = await this.ssoService.completeLogin(code, state);

		// Create session
		const sessionInfo = await this.sessionService.createSession({
			user: loginResult.user,
			providerId: loginResult.session.providerId,
			providerName: this.ssoService.getProvider(loginResult.session.providerId)?.name || 'Unknown',
			userInfo: loginResult.session.userInfo!,
			tokenResponse: {
				access_token: loginResult.session.accessToken!,
				token_type: 'Bearer',
				refresh_token: loginResult.session.refreshToken,
				expires_in: loginResult.session.expiresAt ?
					Math.floor((loginResult.session.expiresAt - Date.now()) / 1000) : undefined,
			},
			idTokenClaims: loginResult.session.idTokenClaims,
			ipAddress,
			userAgent,
		});

		return {
			user: loginResult.user,
			sessionId: sessionInfo.sessionId,
			isNewUser: loginResult.isNewUser,
			action: loginResult.action,
		};
	}

	/**
	 * Refresh user session tokens
	 */
	@bindThis
	public async refreshUserSession(sessionId: string): Promise<boolean> {
		const session = await this.sessionService.getSession(sessionId);
		if (!session || !session.refreshToken) {
			return false;
		}

		const provider = this.ssoService.getProvider(session.providerId);
		if (!provider) {
			return false;
		}

		try {
			const tokenResponse = await this.oauthClientService.refreshToken(
				provider.config,
				session.refreshToken,
			);

			await this.sessionService.updateTokens(sessionId, tokenResponse);
			return true;
		} catch (error) {
			this.logger.error('Failed to refresh session tokens', { sessionId, error });
			return false;
		}
	}

	/**
	 * Logout user session
	 */
	@bindThis
	public async logoutSession(sessionId: string): Promise<void> {
		const session = await this.sessionService.getSession(sessionId);
		if (!session) {
			return;
		}

		// Revoke tokens with provider
		await this.ssoService.logout(session.userId, session.providerId);

		// Delete local session
		await this.sessionService.deleteSession(sessionId);
	}

	/**
	 * Get user sessions
	 */
	@bindThis
	public async getUserSessions(userId: string): Promise<UserSessionApiResult[]> {
		const sessions = await this.sessionService.getUserSessions(userId);

		return sessions.map(session => ({
			sessionId: session.sessionId,
			providerName: session.providerName,
			userInfo: {
				name: session.userInfo.name,
				email: session.userInfo.email,
				picture: session.userInfo.picture,
			},
			createdAt: session.createdAt,
			lastUsedAt: session.lastUsedAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
			isExpired: session.tokenExpiresAt ? session.tokenExpiresAt < new Date() : false,
		}));
	}

	/**
	 * Validate session
	 */
	@bindThis
	public async validateSession(sessionId: string): Promise<boolean> {
		return await this.sessionService.validateSession(sessionId);
	}

	/**
	 * Get OAuth client configuration management service
	 */
	@bindThis
	public getConfigService(): OAuthClientConfigService {
		return this.oauthClientConfigService;
	}

	/**
	 * Get raw OAuth client service
	 */
	@bindThis
	public getOAuthService(): OAuthClientService {
		return this.oauthClientService;
	}

	/**
	 * Get raw OIDC client service
	 */
	@bindThis
	public getOIDCService(): OIDCClientService {
		return this.oidcClientService;
	}

	/**
	 * Get JWT service
	 */
	@bindThis
	public getJWTService(): JWTService {
		return this.jwtService;
	}

	/**
	 * Get SSO service
	 */
	@bindThis
	public getSSOService(): SSOService {
		return this.ssoService;
	}

	/**
	 * Get session service
	 */
	@bindThis
	public getSessionService(): SessionService {
		return this.sessionService;
	}

	/**
	 * Get system statistics
	 */
	@bindThis
	public async getStatistics(): Promise<{
		providers: number;
		sessions: {
			total: number;
			active: number;
			expired: number;
			byProvider: Map<string, number>;
		};
	}> {
		const providers = this.ssoService.getProviders();
		const sessionStats = await this.sessionService.getStatistics();

		return {
			providers: providers.length,
			sessions: {
				total: sessionStats.totalSessions,
				active: sessionStats.activeSessions,
				expired: sessionStats.expiredSessions,
				byProvider: sessionStats.sessionsByProvider,
			},
		};
	}

	/**
	 * Health check
	 */
	@bindThis
	public async healthCheck(): Promise<{
		status: 'ok' | 'degraded' | 'error';
		providers: number;
		activeSessions: number;
		errors: string[];
	}> {
		const errors: string[] = [];

		try {
			const stats = await this.getStatistics();

			return {
				status: errors.length > 0 ? 'degraded' : 'ok',
				providers: stats.providers,
				activeSessions: stats.sessions.active,
				errors,
			};
		} catch (error) {
			errors.push(error instanceof Error ? error.message : 'Unknown error');

			return {
				status: 'error',
				providers: 0,
				activeSessions: 0,
				errors,
			};
		}
	}
}
