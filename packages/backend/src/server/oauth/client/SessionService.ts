/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import type { UserSessionsRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import type { UserInfo, TokenResponse } from './OAuthClientService.js';
import type { IDTokenClaims } from './OIDCClientService.js';

export interface SessionInfo {
	sessionId: string;
	userId: string;
	providerId: string;
	providerName: string;
	userInfo: UserInfo;
	accessToken: string | null;
	refreshToken: string | null;
	tokenExpiresAt: Date | null;
	createdAt: Date;
	lastUsedAt: Date;
	ipAddress?: string | null;
	userAgent?: string | null;
}

export interface CreateSessionRequest {
	user: MiLocalUser;
	providerId: string;
	providerName: string;
	userInfo: UserInfo;
	tokenResponse: TokenResponse;
	idTokenClaims?: IDTokenClaims;
	ipAddress?: string;
	userAgent?: string;
}

@Injectable()
export class SessionService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.userSessionsRepository)
		private readonly userSessionsRepository: UserSessionsRepository,

		private readonly loggerService: LoggerService,
		private readonly idService: IdService,
	) {
		this.logger = this.loggerService.getLogger('session');
	}

	/**
	 * Create new session
	 */
	@bindThis
	public async createSession(request: CreateSessionRequest): Promise<SessionInfo> {
		const sessionId = this.idService.gen();
		const now = new Date();
		const expiresAt = request.tokenResponse.expires_in 
			? new Date(Date.now() + (request.tokenResponse.expires_in * 1000))
			: null;
		try {
			// Store in database using direct query to ensure field mapping
			await this.userSessionsRepository
				.createQueryBuilder()
				.insert()
				.into('user_session')
				.values({
					id: sessionId,
					userId: request.user.id,
					providerId: request.providerId,
					providerName: request.providerName,
					userInfo: request.userInfo,
					idTokenClaims: request.idTokenClaims || null,
					accessToken: request.tokenResponse.access_token || null,
					refreshToken: request.tokenResponse.refresh_token || null,
					tokenExpiresAt: expiresAt,
					ipAddress: request.ipAddress || null,
					userAgent: request.userAgent || null,
					createdAt: now,
					lastUsedAt: now,
				})
				.execute();
		} catch (error) {
			this.logger.error('Failed to create session', { sessionId, userId: request.user.id, error });
			throw new Error(`Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}

		const sessionInfo: SessionInfo = {
			sessionId,
			userId: request.user.id,
			providerId: request.providerId,
			providerName: request.providerName,
			userInfo: request.userInfo,
			accessToken: request.tokenResponse.access_token || null,
			refreshToken: request.tokenResponse.refresh_token || null,
			tokenExpiresAt: expiresAt,
			createdAt: now,
			lastUsedAt: now,
			ipAddress: request.ipAddress,
			userAgent: request.userAgent,
		};

		this.logger.info(`Created new session for user ${request.user.id} via ${request.providerName}`);

		return sessionInfo;
	}

	/**
	 * Get session by ID
	 */
	@bindThis
	public async getSession(sessionId: string): Promise<SessionInfo | null> {
		const session = await this.userSessionsRepository.findOne({
			where: { id: sessionId },
		});

		if (!session) {
			return null;
		}

		return {
			sessionId: session.id,
			userId: session.userId,
			providerId: session.providerId,
			providerName: session.providerName,
			userInfo: session.userInfo,
			accessToken: session.accessToken,
			refreshToken: session.refreshToken,
			tokenExpiresAt: session.tokenExpiresAt,
			createdAt: session.createdAt,
			lastUsedAt: session.lastUsedAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
		};
	}

	/**
	 * Update session tokens
	 */
	@bindThis
	public async updateTokens(sessionId: string, tokenResponse: TokenResponse): Promise<void> {
		const expiresAt = tokenResponse.expires_in 
			? new Date(Date.now() + (tokenResponse.expires_in * 1000))
			: null;

		try {
			const result = await this.userSessionsRepository.update(
				{ id: sessionId },
				{
					accessToken: tokenResponse.access_token || null,
					refreshToken: tokenResponse.refresh_token || null,
					tokenExpiresAt: expiresAt,
					lastUsedAt: new Date(),
				}
			);

			if (result.affected === 0) {
				throw new Error('Session not found');
			}

			this.logger.info(`Updated tokens for session ${sessionId}`);
		} catch (error) {
			this.logger.error('Failed to update session tokens', { sessionId, error });
			throw error;
		}
	}

	/**
	 * Validate session
	 */
	@bindThis
	public async validateSession(sessionId: string): Promise<boolean> {
		try {
			const session = await this.userSessionsRepository.findOne({
				where: { id: sessionId },
			});

			if (!session) {
				return false;
			}

			// Check if token is expired
			if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
				return false;
			}

			// Update last used time
			await this.userSessionsRepository.update(
				{ id: sessionId },
				{ lastUsedAt: new Date() }
			);

			return true;
		} catch (error) {
			this.logger.error('Failed to validate session', { sessionId, error });
			return false;
		}
	}

	/**
	 * Delete session
	 */
	@bindThis
	public async deleteSession(sessionId: string): Promise<void> {
		try {
			const result = await this.userSessionsRepository.delete({ id: sessionId });
			if (result.affected && result.affected > 0) {
				this.logger.info(`Deleted session ${sessionId}`);
			} else {
				this.logger.warn(`Session ${sessionId} not found for deletion`);
			}
		} catch (error) {
			this.logger.error('Failed to delete session', { sessionId, error });
			throw error;
		}
	}

	/**
	 * Get user sessions
	 */
	@bindThis
	public async getUserSessions(userId: string): Promise<SessionInfo[]> {
		try {
			const sessions = await this.userSessionsRepository.find({
				where: { userId },
				order: { createdAt: 'DESC' },
			});

			return sessions.map(session => ({
				sessionId: session.id,
				userId: session.userId,
				providerId: session.providerId,
				providerName: session.providerName,
				userInfo: session.userInfo,
				accessToken: session.accessToken,
				refreshToken: session.refreshToken,
				tokenExpiresAt: session.tokenExpiresAt,
				createdAt: session.createdAt,
				lastUsedAt: session.lastUsedAt,
				ipAddress: session.ipAddress,
				userAgent: session.userAgent,
			}));
		} catch (error) {
			this.logger.error('Failed to get user sessions', { userId, error });
			throw error;
		}
	}

	/**
	 * Delete user sessions
	 */
	@bindThis
	public async deleteUserSessions(userId: string): Promise<void> {
		const result = await this.userSessionsRepository.delete({ userId });
		this.logger.info(`Deleted ${result.affected || 0} sessions for user ${userId}`);
	}

	/**
	 * Clean up expired sessions
	 */
	@bindThis
	public async cleanupExpiredSessions(): Promise<void> {
		try {
			const result = await this.userSessionsRepository
				.createQueryBuilder('session')
				.delete()
				.where('session.tokenExpiresAt < :now AND session.tokenExpiresAt IS NOT NULL', { now: new Date() })
				.execute();

			this.logger.info(`Cleaned up ${result.affected || 0} expired sessions`);
		} catch (error) {
			this.logger.error('Failed to cleanup expired sessions', { error });
			throw error;
		}
	}

	/**
	 * Get session statistics
	 */
	@bindThis
	public async getStatistics(): Promise<{
		totalSessions: number;
		activeSessions: number;
		expiredSessions: number;
		sessionsByProvider: Map<string, number>;
	}> {
		try {
			const now = new Date();
			
			const [total, expired] = await Promise.all([
				this.userSessionsRepository.count(),
				this.userSessionsRepository
					.createQueryBuilder('session')
					.where('session.tokenExpiresAt < :now AND session.tokenExpiresAt IS NOT NULL', { now })
					.getCount(),
			]);

			const active = total - expired;

			// Get sessions by provider
			const providerCounts = await this.userSessionsRepository
				.createQueryBuilder('session')
				.select('session.providerId', 'providerId')
				.addSelect('COUNT(*)', 'count')
				.groupBy('session.providerId')
				.getRawMany();

			const sessionsByProvider = new Map<string, number>();
			for (const row of providerCounts) {
				sessionsByProvider.set(row.providerId, parseInt(row.count, 10));
			}

			return {
				totalSessions: total,
				activeSessions: active,
				expiredSessions: expired,
				sessionsByProvider,
			};
		} catch (error) {
			this.logger.error('Failed to get session statistics', { error });
			throw error;
		}
	}
}