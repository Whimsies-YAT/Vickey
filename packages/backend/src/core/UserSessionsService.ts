/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { UserSessionsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { IdService } from '@/core/IdService.js';
import { generateDeviceId, generateNewToken, isNewToken } from '@/misc/token.js';

type ActiveUserSessionCacheData = {
	token: string;
	userId: string;
	lastUsedAt: Date;
	ip?: Array<{ address: string; count: number; lastSeen: Date }> | null;
};

@Injectable()
export class UserSessionsService implements OnModuleInit, OnApplicationShutdown {
	private static readonly OPERATION_LOCK_TTL = 1000 * 10;
	private static readonly CONSISTENCY_LOCK_TTL = 1000 * 5;
	private static readonly CACHE_TTL = 1000 * 60 * 60 * 24 * 31;

	private logger: Logger;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		private loggerService: LoggerService,
		private idService: IdService,
	) {
		this.logger = this.loggerService.getLogger('syncSessions');
	}

	@bindThis
	public async onModuleInit(): Promise<void> {
		// await this.loadActiveUserSessionsToRedis();
	}

	public async loadActiveUserSessionsToRedis() {
		const sessions = await this.userSessionsRepository.find({
			where: { isActive: true },
			select: ['token', 'userId', 'lastUsedAt', 'expiresAt'],
			order: { lastUsedAt: 'DESC' },
			take: 1000
		});

		if (sessions.length === 0) {
			return;
		}

		const pipeline = this.redisClient.pipeline();
		let loadedCount = 0;

		for (const session of sessions) {
			if (session.expiresAt && session.expiresAt <= new Date()) {
				this.logger.warn(`Skipping expired session: ${session.token.slice(-5)}...`);
				continue;
			}

			const cacheKey = `activeUserSession:${session.token}`;
			const cacheData = JSON.stringify({
				token: session.token,
				userId: session.userId,
				lastUsedAt: session.lastUsedAt
			});

			pipeline.set(cacheKey, cacheData, 'PX', 1000 * 60 * 30);
			loadedCount++;

			this.logger.debug(`Queuing: ${cacheKey}`);
		}

		this.logger.info(`Executing pipeline with ${loadedCount} operations`);
		const result = await pipeline.exec();

		if (result) {
			const successCount = result.filter(r => r && r[0] === null).length;
			const failCount = result.length - successCount;
			this.logger.info(`Pipeline result: ${successCount} success, ${failCount} failed`);

			if (failCount > 0) {
				const failures = result.filter(r => r && r[0] !== null);
				for (const failure of failures.slice(-3)) {
					this.logger.error('Pipeline failure:', failure[0]);
				}
			}
		} else {
			this.logger.error('Pipeline exec returned null');
		}

		const verifyKeys = await this.redisClient.keys('activeUserSession:*');
		this.logger.info(`After pipeline: found ${verifyKeys.length} keys in Redis`);
	}

	private updateIpList(currentIpList: Array<{
		address: string;
		count: number;
		lastSeen: Date
	}> | null | undefined, newIp: string): Array<{ address: string; count: number; lastSeen: Date }> {
		const ipList = currentIpList || [];
		const now = new Date();

		const existingIndex = ipList.findIndex(item => item.address === newIp);

		if (existingIndex >= 0) {
			const existingItem = ipList[existingIndex];
			existingItem.count++;
			existingItem.lastSeen = now;
			ipList.splice(existingIndex, 1);
			ipList.unshift(existingItem);
		} else {
			ipList.unshift({
				address: newIp,
				count: 1,
				lastSeen: now
			});
		}

		return ipList.slice(-100);
	}

	@bindThis
	public async validateToken(token: string, expectedUserId?: string, clientIp?: string): Promise<{
		isValid: boolean;
		needRefresh: boolean;
		signInId?: string;
		deviceId?: string;
		isExpired?: boolean;
		isActive?: boolean;
		userId?: string;
		lastUsedAt?: Date;
		reason?: string;
		ip?: Array<{ address: string; count: number; lastSeen: Date }> | null;
	}> {
		const tokenValidation = isNewToken(token, false);
		if (!token || !tokenValidation.valid) {
			if (token && !tokenValidation.valid) {
				try {
					await this.userSessionsRepository.update(
						{ token, isActive: true },
						{ isActive: false, expiresAt: new Date() }
					);
					await this.redisClient.del(`activeUserSession:${token}`);
					this.logger.warn(`Invalidated expired token: ${token.slice(-5)}...`);
				} catch (error) {
					this.logger.warn(`Failed to invalidate expired token: ${error}`);
				}
			}

			return {
				isValid: false,
				needRefresh: false,
				reason: 'Invalid or expired token format'
			};
		}

		try {
			const cacheDataRaw = await this.redisClient.get(`activeUserSession:${token}`);
			const cacheData = cacheDataRaw ? JSON.parse(cacheDataRaw) as ActiveUserSessionCacheData : null;

			if (cacheData) {
				const dbSession = await this.userSessionsRepository.findOne({
					where: { token, isActive: true },
					select: ['token', 'userId', 'lastUsedAt', 'expiresAt', 'isActive', 'signInId', 'deviceId']
				});

				if (!dbSession) {
					await this.redisClient.del(`activeUserSession:${token}`);
					return {
						isValid: false,
						needRefresh: false,
						reason: 'Token not found in database'
					};
				}

				const currentTime = new Date();
				this.logger.debug(`Token validation: expiresAt=${dbSession.expiresAt.toISOString()}, now=${currentTime.toISOString()}, isActive=${dbSession.isActive}, token=${token.slice(-10)}...`);

				if (dbSession.expiresAt <= currentTime) {
					this.logger.warn(`Token expired: expiresAt=${dbSession.expiresAt.toISOString()}, now=${currentTime.toISOString()}, token=${token.slice(-10)}...`);
					await this.redisClient.del(`activeUserSession:${token}`);
					return {
						isValid: false,
						needRefresh: false,
						isExpired: true,
						reason: 'Token has expired'
					};
				}

				if (!dbSession.isActive) {
					await this.redisClient.del(`activeUserSession:${token}`);
					return {
						isValid: false,
						needRefresh: false,
						isActive: false,
						reason: 'Token is not active'
					};
				}

				if (expectedUserId && dbSession.userId !== expectedUserId) {
					return {
						isValid: false,
						needRefresh: false,
						userId: dbSession.userId,
						reason: 'Token does not belong to the expected user'
					};
				}

				let updatedIpList = cacheData.ip;
				if (clientIp) {
					updatedIpList = this.updateIpList(cacheData.ip, clientIp);
				}

				try {
					const newCacheData = {
						token: token,
						userId: dbSession.userId,
						lastUsedAt: currentTime,
						ip: updatedIpList
					};
					await this.redisClient.setex(
						`activeUserSession:${token}`,
						Math.floor(UserSessionsService.CACHE_TTL / 1000),
						JSON.stringify(newCacheData)
					);
				} catch (e) {
					const updateError = e as Error;
					this.logger.warn(`Failed to update lastUsedAt for token ${token.slice(-5)}:`, updateError);
				}

				return {
					isValid: true,
					needRefresh: tokenValidation.needRefresh,
					isExpired: false,
					isActive: true,
					signInId: dbSession.signInId,
					deviceId: dbSession.deviceId,
					userId: dbSession.userId,
					lastUsedAt: currentTime,
					ip: updatedIpList
				};
			} else {
				const dbSession = await this.userSessionsRepository.findOne({
					where: { token, isActive: true },
					select: ['token', 'userId', 'lastUsedAt', 'expiresAt', 'isActive', 'signInId', 'deviceId'],
				});

				if (!dbSession) {
					return {
						isValid: false,
						needRefresh: false,
						reason: 'Token not found'
					};
				}

				const currentTime = new Date();
				this.logger.debug(`Token validation (no cache): expiresAt=${dbSession.expiresAt.toISOString()}, now=${currentTime.toISOString()}, isActive=${dbSession.isActive}, token=${token.slice(-10)}...`);

				if (dbSession.expiresAt <= currentTime) {
					this.logger.warn(`Token expired (no cache): expiresAt=${dbSession.expiresAt.toISOString()}, now=${currentTime.toISOString()}, token=${token.slice(-10)}...`);
					return {
						isValid: false,
						needRefresh: false,
						isExpired: true,
						reason: 'Token has expired'
					};
				}

				if (!dbSession.isActive) {
					return {
						isValid: false,
						needRefresh: false,
						isActive: false,
						reason: 'Token is not active'
					};
				}

				if (expectedUserId && dbSession.userId !== expectedUserId) {
					return {
						isValid: false,
						needRefresh: false,
						userId: dbSession.userId,
						reason: 'Token does not belong to the expected user'
					};
				}

				if (clientIp) {
					const session = await this.userSessionsRepository.findOne({
						where: { token, isActive: true },
						select: ['ip']
					});
					if (session) {
						const updatedIpList = this.updateIpList(session.ip, clientIp);
						await this.userSessionsRepository.update(
							{ token, isActive: true },
							{ ip: updatedIpList, lastUsedAt: currentTime } as any
						);
					}
				} else {
					await this.userSessionsRepository.update(
						{ token, isActive: true },
						{ lastUsedAt: currentTime }
					);
				}

				let ipListForCache: Array<{ address: string; count: number; lastSeen: Date }> | null = null;
				if (clientIp) {
					const sessionForCache = await this.userSessionsRepository.findOne({
						where: { token, isActive: true },
						select: ['ip']
					});
					ipListForCache = sessionForCache?.ip || null;
				}

				const cacheData = {
					token: dbSession.token,
					userId: dbSession.userId,
					lastUsedAt: currentTime,
					ip: ipListForCache
				};
				await this.redisClient.setex(
					`activeUserSession:${token}`,
					Math.floor(UserSessionsService.CACHE_TTL / 1000),
					JSON.stringify(cacheData)
				);

				return {
					isValid: true,
					needRefresh: tokenValidation.needRefresh,
					isExpired: false,
					isActive: true,
					signInId: dbSession.signInId,
					deviceId: dbSession.deviceId,
					userId: dbSession.userId,
					lastUsedAt: currentTime,
					ip: ipListForCache
				};
			}
		} catch (e) {
			const error = e as Error;
			this.logger.error(`Token validation failed for ${token.slice(-5)}:`, error);
			return {
				isValid: false,
				needRefresh: false,
				reason: 'Internal validation error'
			};
		}
	}

	private async flushCacheToDatabase(tokens: string[]): Promise<void> {
		if (tokens.length === 0) return;

		const cacheKeys = tokens.map(token => `activeUserSession:${token}`);
		const cacheValues = await this.redisClient.mget(cacheKeys);

		const updates: Array<{ token: string; userId: string; lastUsedAt: Date; ip?: Array<{ address: string; count: number; lastSeen: Date }> | null }> = [];

		for (let i = 0; i < tokens.length; i++) {
			const raw = cacheValues[i];
			if (!raw) continue;

			try {
				const parsed = JSON.parse(raw) as ActiveUserSessionCacheData;
				if (parsed.token === tokens[i]) {
					updates.push({
						token: parsed.token,
						userId: parsed.userId,
						lastUsedAt: new Date(parsed.lastUsedAt),
						ip: parsed.ip || null
					});
				}
			} catch (err) {
				const e = err as Error;
				this.logger.warn(`Failed to parse cache data for token ${tokens[i].slice(-5)}:`, e);
			}
		}

		if (updates.length > 0) {
			try {
				await this.batchUpdateSessionsWithTransaction(updates);
				this.logger.info(`Flushed ${updates.length} cache entries to database before invalidation`);
			} catch (e) {
				const err = e as Error;
				this.logger.warn(`Failed to flush cache to database:`, err);
			}
		}
	}

	@bindThis
	public async invalidateTokenSafely(userId: string, token?: string): Promise<{
		success: boolean;
		invalidatedCount: number;
		reason?: string;
	}> {
		if (token) {
			const validation = await this.validateToken(token, userId);

			if (!validation.isValid) {
				return {
					success: false,
					invalidatedCount: 0,
					reason: validation.reason
				};
			}

			const lockKey = `operation_lock:${token}`;
			const lockAcquired = await this.redisClient.set(
				lockKey,
				process.pid.toString(),
				'PX',
				UserSessionsService.OPERATION_LOCK_TTL,
				'NX'
			);

			if (!lockAcquired) {
				this.logger.warn(`Could not acquire lock for token invalidation: ${token.slice(-5)}`);
				return {
					success: false,
					invalidatedCount: 0,
					reason: 'Could not acquire lock'
				};
			}

			try {
				await this.flushCacheToDatabase([token]);

				const expiredTime = new Date(Date.now() - 1000);
				await Promise.all([
					this.userSessionsRepository.update(
						{ token, isActive: true },
						{ isActive: false, expiresAt: expiredTime }
					),
					this.redisClient.del(`activeUserSession:${token}`)
				]);

				return {
					success: true,
					invalidatedCount: 1
				};
			} catch (e) {
				const err = e as Error;
				this.logger.error(`Failed to invalidate token ${token.slice(-5)}:`, err);
				return {
					success: false,
					invalidatedCount: 0,
					reason: 'Database operation failed'
				};
			} finally {
				await this.redisClient.del(lockKey);
			}
		} else {
			const userLockKey = `user_operation_lock:${userId}`;
			const lockAcquired = await this.redisClient.set(
				userLockKey,
				process.pid.toString(),
				'PX',
				UserSessionsService.OPERATION_LOCK_TTL,
				'NX'
			);

			if (!lockAcquired) {
				this.logger.warn(`Could not acquire lock for user token invalidation: ${userId}`);
				return {
					success: false,
					invalidatedCount: 0,
					reason: 'Could not acquire user lock'
				};
			}

			try {
				const activeSessions = await this.userSessionsRepository.find({
					where: { userId, isActive: true },
					select: ['token']
				});

				if (activeSessions.length === 0) {
					return {
						success: true,
						invalidatedCount: 0,
						reason: 'No active sessions found'
					};
				}

				const tokens = activeSessions.map(session => session.token);
				await this.flushCacheToDatabase(tokens);

				const expiredTime = new Date(Date.now() - 1000);
				const cacheKeys = activeSessions.map(session => `activeUserSession:${session.token}`);

				await Promise.all([
					this.userSessionsRepository.update(
						{ userId, isActive: true },
						{ isActive: false, expiresAt: expiredTime }
					),
					this.redisClient.del(...cacheKeys)
				]);

				return {
					success: true,
					invalidatedCount: activeSessions.length
				};
			} catch (e) {
				const err = e as Error;
				this.logger.error(`Failed to invalidate all tokens for user ${userId}:`, err);
				return {
					success: false,
					invalidatedCount: 0,
					reason: 'Database operation failed'
				};
			} finally {
				await this.redisClient.del(userLockKey);
			}
		}
	}

	@bindThis
	public async cleanupExpiredTokens(): Promise<{
		success: boolean;
		deletedCount: number;
		reason?: string;
	}> {
		const CLEANUP_LOCK_KEY = 'cleanup_expired_tokens:lock';
		const CLEANUP_LOCK_TTL = 1000 * 60 * 30;
		const BATCH_SIZE = 1000;
		const THREE_MONTHS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

		const lockAcquired = await this.redisClient.set(
			CLEANUP_LOCK_KEY,
			process.pid.toString(),
			'PX',
			CLEANUP_LOCK_TTL,
			'NX'
		);

		if (!lockAcquired) {
			this.logger.warn('Cleanup already in progress by another instance');
			return {
				success: false,
				deletedCount: 0,
				reason: 'Cleanup already in progress'
			};
		}

		let totalDeleted = 0;

		try {
			this.logger.info(`Starting cleanup of tokens expired before ${THREE_MONTHS_AGO.toISOString()}`);

			while (true) {
				const expiredTokens = await this.userSessionsRepository.createQueryBuilder('session')
					.select(['session.id', 'session.token'])
					.where('session.expiresAt < :threeMonthsAgo', { threeMonthsAgo: THREE_MONTHS_AGO })
					.andWhere('session.isActive = false')
					.take(BATCH_SIZE)
					.getMany();

				if (expiredTokens.length === 0) {
					break;
				}

				const tokenIds = expiredTokens.map(t => t.id);
				const cacheKeys = expiredTokens.map(t => `activeUserSession:${t.token}`);

				await Promise.all([
					this.userSessionsRepository.delete(tokenIds),
					cacheKeys.length > 0 ? this.redisClient.del(...cacheKeys) : Promise.resolve()
				]);

				totalDeleted += expiredTokens.length;
				this.logger.info(`Deleted batch of ${expiredTokens.length} expired tokens (total: ${totalDeleted})`);

				if (expiredTokens.length === BATCH_SIZE) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			await this.cleanupOrphanedCacheEntries();

			this.logger.succ(`Cleanup completed: deleted ${totalDeleted} expired tokens`);

			return {
				success: true,
				deletedCount: totalDeleted
			};
		} catch (e) {
			const error = e as Error;
			this.logger.error('Failed to cleanup expired tokens:', error);
			return {
				success: false,
				deletedCount: totalDeleted,
				reason: 'Database operation failed'
			};
		} finally {
			await this.redisClient.del(CLEANUP_LOCK_KEY);
		}
	}

	@bindThis
	private async cleanupOrphanedCacheEntries(): Promise<void> {
		try {
			const SCAN_BATCH_SIZE = 100;
			let cursor = '0';
			let cleanedCount = 0;

			do {
				const [nextCursor, keys] = await this.redisClient.scan(
					cursor,
					'MATCH', 'activeUserSession:*',
					'COUNT', SCAN_BATCH_SIZE.toString()
				);
				cursor = nextCursor;

				if (keys.length > 0) {
					const tokens = keys.map(key => key.replace('activeUserSession:', ''));

					const existingTokens = await this.userSessionsRepository.createQueryBuilder('session')
						.select(['session.token'])
						.where('session.token IN (:...tokens)', { tokens })
						.andWhere('session.isActive = true')
						.getMany();

					const existingTokenSet = new Set(existingTokens.map(t => t.token));
					const orphanedKeys = keys.filter(key => {
						const token = key.replace('activeUserSession:', '');
						return !existingTokenSet.has(token);
					});

					if (orphanedKeys.length > 0) {
						await this.redisClient.del(...orphanedKeys);
						cleanedCount += orphanedKeys.length;
					}
				}
			} while (cursor !== '0');

			if (cleanedCount > 0) {
				this.logger.info(`Cleaned ${cleanedCount} orphaned cache entries`);
			}
		} catch (e) {
			const error = e as Error;
			this.logger.warn('Failed to cleanup orphaned cache entries:', error);
		}
	}

	@bindThis
	public async createTokenSafely(sessionData: {
		userId: string;
		signInId?: string;
		deviceInfo?: string;
		deviceId?: string;
		clientIp?: string;
		inheritIpFrom?: string;
		inheritedIp?: Array<{ address: string; count: number; lastSeen: Date }>;
	}): Promise<string | null> {
		const deviceId = sessionData.deviceId || generateDeviceId(sessionData.deviceInfo);
		const token = generateNewToken(1);
		const lockKey = `operation_lock:${token}`;
		const lockAcquired = await this.redisClient.set(
			lockKey,
			process.pid.toString(),
			'PX',
			UserSessionsService.OPERATION_LOCK_TTL,
			'NX'
		);

		if (!lockAcquired) {
			this.logger.warn(`Could not acquire lock for token creation: ${token.slice(-5)}`);
			return null;
		}

		try {
			const newTime = new Date();
			let initialIpList: Array<{ address: string; count: number; lastSeen: Date }> | null = null;

			if (sessionData.inheritedIp) {
				initialIpList = [...sessionData.inheritedIp];
				if (sessionData.clientIp) {
					initialIpList = this.updateIpList(initialIpList, sessionData.clientIp);
				}
			}

			if (!initialIpList && sessionData.clientIp) {
				initialIpList = [{
					address: sessionData.clientIp,
					count: 1,
					lastSeen: newTime
				}];
			}

			await this.userSessionsRepository.save({
				id: this.idService.gen(),
				token: token,
				userId: sessionData.userId,
				signInId: sessionData.signInId,
				deviceId,
				createdAt: newTime,
				lastUsedAt: newTime,
				isActive: true,
				ip: initialIpList,
			} as any);

			const cacheData = {
				token: token,
				userId: sessionData.userId,
				lastUsedAt: newTime,
				ip: initialIpList
			};

			await this.redisClient.setex(
				`activeUserSession:${token}`,
				Math.floor(UserSessionsService.CACHE_TTL / 1000),
				JSON.stringify(cacheData)
			);

			return token;
		} catch (e) {
			const err = e as Error;
			this.logger.error(`Failed to create token ${token.slice(-5)}:`, err);
			return null;
		} finally {
			await this.redisClient.del(lockKey);
		}
	}

	@bindThis
	public async clearSyncLock(): Promise<void> {
		const LOCK_KEY = 'syncTokenCacheWithDatabase:lock';
		await this.redisClient.del(LOCK_KEY);
		this.logger.info('Sync lock cleared');
	}

	@bindThis
	public async syncTokenCacheWithDatabase(): Promise<void> {
		const LOCK_KEY = 'syncTokenCacheWithDatabase:lock';
		const LOCK_TTL = 1000 * 60 * 5;
		const BATCH_SIZE = 50;
		const EXTEND_LOCK_INTERVAL = 1000 * 30;
		const MAX_RETRIES = 3;

		let retryCount = 0;
		const lastProcessedCursor = '0';
		const processedCursor = 0;

		const gotLock = await this.redisClient.set(LOCK_KEY, process.pid.toString(), 'PX', LOCK_TTL, 'NX');
		if (!gotLock) {
			const lockTTL = await this.redisClient.pttl(LOCK_KEY);
			if (lockTTL === -1) {
				this.logger.warn('Found orphaned lock without TTL, removing it');
				await this.redisClient.del(LOCK_KEY);
				const retryLock = await this.redisClient.set(LOCK_KEY, process.pid.toString(), 'PX', LOCK_TTL, 'NX');
				if (!retryLock) {
					this.logger.info('Another instance is running, skip.');
					return;
				}
			} else {
				this.logger.info(`Another instance is running, skip. Lock expires in ${lockTTL}ms`);
				return;
			}
		}

		const lockExtender = setInterval(async () => {
			try {
				await this.redisClient.pexpire(LOCK_KEY, LOCK_TTL);
			} catch (e) {
				const err = e as Error;
				this.logger.warn('Failed to extend lock:', err);
			}
		}, EXTEND_LOCK_INTERVAL);

		try {
			this.logger.info('Start sync.');

			while (retryCount <= MAX_RETRIES) {
				try {
					await this.processInBatches(BATCH_SIZE);
					break;
				} catch (e) {
					const err = e as Error;
					retryCount++;

					if (retryCount > MAX_RETRIES) {
						this.logger.error(`Max retries (${MAX_RETRIES}) exceeded:`, err);
						await this.handlePartialFailureRecovery(err, lastProcessedCursor, processedCursor);
						throw err;
					}

					const backoffDelay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
					this.logger.warn(`Retry ${retryCount}/${MAX_RETRIES} after ${backoffDelay}ms delay:`, err);

					await this.prepareRetry(err, retryCount);
					await new Promise(resolve => setTimeout(resolve, backoffDelay));
				}
			}

			await this.performConsistencyCheck();
			this.logger.succ('Sync complete.');
		} catch (e) {
			const err = e as Error;
			this.logger.error('Final error:', err);
			throw err;
		} finally {
			clearInterval(lockExtender);
			await this.redisClient.del(LOCK_KEY);
		}
	}

	private async processInBatches(batchSize: number): Promise<void> {
		let offset = 0;
		let totalProcessed = 0;

		while (true) {
			const activeSessions = await this.userSessionsRepository.find({
				where: { isActive: true },
				select: ['token'],
				order: { lastUsedAt: 'DESC' },
				skip: offset,
				take: batchSize
			});

			if (activeSessions.length === 0) {
				break;
			}

			const cacheKeys = activeSessions.map(session => `activeUserSession:${session.token}`);

			const cacheValues = await this.redisClient.mget(cacheKeys);

			const existingKeys: string[] = [];
			for (let i = 0; i < cacheKeys.length; i++) {
				if (cacheValues[i] !== null) {
					existingKeys.push(cacheKeys[i]);
				}
			}

			if (existingKeys.length > 0) {
				await this.processBatchWithConsistency(existingKeys);
				totalProcessed += existingKeys.length;
			}

			offset += batchSize;
		}

		this.logger.info(`Process completed. Total processed: ${totalProcessed} cache entries`);
	}

	private async processBatchWithConsistency(keys: string[]): Promise<void> {
		const MAX_BATCH_RETRIES = 2;
		let attempt = 0;

		while (attempt <= MAX_BATCH_RETRIES) {
			try {
				await this.processBatchWithLocks(keys);
				return;
			} catch (e) {
				const err = e as Error;
				attempt++;
				if (attempt > MAX_BATCH_RETRIES) {
					this.logger.error(`Failed after ${MAX_BATCH_RETRIES} retries:`, err);
					await this.processBatchIndividually(keys);
					return;
				}

				const delay = 500 * attempt;
				this.logger.warn(`Retry ${attempt}/${MAX_BATCH_RETRIES} after ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	private async processBatchWithLocks(keys: string[]): Promise<void> {
		const tokens = keys.map(key => key.replace('activeUserSession:', ''));
		const lockResults = await this.acquireTokenLocks(tokens);

		try {
			const lockedTokens = tokens.filter((_, index) => lockResults[index]);
			const lockedKeys = lockedTokens.map(token => `activeUserSession:${token}`);

			if (lockedKeys.length === 0) {
				this.logger.warn('No tokens could be locked, skipping batch');
				return;
			}

			if (lockedKeys.length !== keys.length) {
				this.logger.warn(`Could only lock ${lockedKeys.length}/${keys.length} tokens`);
			}

			await this.processBatchSafely(lockedKeys, lockedTokens);
		} finally {
			await this.releaseTokenLocks(tokens.filter((_, index) => lockResults[index]));
		}
	}

	private async acquireTokenLocks(tokens: string[]): Promise<boolean[]> {
		const results: boolean[] = [];

		for (const token of tokens) {
			const lockKey = `operation_lock:${token}`;
			try {
				const acquired = await this.redisClient.set(
					lockKey,
					process.pid.toString(),
					'PX',
					UserSessionsService.OPERATION_LOCK_TTL,
					'NX'
				);
				results.push(!!acquired);
			} catch (e) {
				results.push(false);
			}
		}

		return results;
	}

	private async releaseTokenLocks(tokens: string[]): Promise<void> {
		const lockKeys = tokens.map(token => `operation_lock:${token}`);
		if (lockKeys.length > 0) {
			try {
				await this.redisClient.del(...lockKeys);
			} catch (e) {
				const err = e as Error;
				this.logger.warn('Failed to release some locks:', err);
			}
		}
	}

	private async processBatchSafely(keys: string[], tokens: string[]): Promise<void> {
		const values = await this.redisClient.mget(keys);
		const cacheEntries: ActiveUserSessionCacheData[] = [];
		const invalidKeys: string[] = [];

		for (let i = 0; i < keys.length; i++) {
			const raw = values[i];
			if (!raw) continue;

			try {
				const parsed = JSON.parse(raw) as ActiveUserSessionCacheData;
				if (parsed.token === tokens[i]) {
					cacheEntries.push(parsed);
				} else {
					this.logger.warn(`Token mismatch in cache entry: ${keys[i]}`);
					invalidKeys.push(keys[i]);
				}
			} catch {
				invalidKeys.push(keys[i]);
			}
		}

		if (invalidKeys.length > 0) {
			await this.redisClient.del(...invalidKeys);
		}

		if (cacheEntries.length === 0) return;

		const sessionsFromDB = await this.userSessionsRepository.manager.transaction(async (manager) => {
			return await manager.find(this.userSessionsRepository.target, {
				where: { token: In(tokens), isActive: true },
				select: ['token', 'userId', 'lastUsedAt', 'expiresAt', 'ip'],
				lock: { mode: 'pessimistic_read' }
			});
		});

		const dbMap = new Map<string, { userId: string; lastUsedAt: Date; expiresAt: Date }>();
		for (const s of sessionsFromDB) {
			dbMap.set(s.token, {
				userId: s.userId,
				lastUsedAt: s.lastUsedAt,
				expiresAt: s.expiresAt
			});
		}

		const updates: Array<{ token: string; userId: string; lastUsedAt: Date; ip?: Array<{ address: string; count: number; lastSeen: Date }> | null }> = [];
		const deletes: string[] = [];
		const currentTime = new Date();

		for (const entry of cacheEntries) {
			const dbSession = dbMap.get(entry.token);

			if (!dbSession || dbSession.expiresAt <= currentTime) {
				deletes.push(`activeUserSession:${entry.token}`);
				continue;
			}

			if (dbSession.userId !== entry.userId) {
				this.logger.warn(`UserId mismatch for token ${entry.token.slice(-5)}: cache=${entry.userId}, db=${dbSession.userId}`);
				deletes.push(`activeUserSession:${entry.token}`);
				continue;
			}

			const cacheTime = new Date(entry.lastUsedAt);
			const dbTime = new Date(dbSession.lastUsedAt);

			// this.logger.info(`Token ${entry.token.slice(-8)}: DB=${dbTime.toISOString()}, Cache=${cacheTime.toISOString()}, needsUpdate=${dbTime.getTime() < cacheTime.getTime()}`);

			if (dbTime.getTime() < cacheTime.getTime()) {
				// this.logger.info(`Will update token ${entry.token.slice(-8)} from ${dbTime.toISOString()} to ${cacheTime.toISOString()}`);
				updates.push({
					token: entry.token,
					userId: entry.userId,
					lastUsedAt: cacheTime,
					ip: entry.ip || null
				});
			} else {
				// this.logger.info(`No update needed for token ${entry.token.slice(-8)}: cache time (${cacheTime.toISOString()}) is not newer than DB time (${dbTime.toISOString()})`);
			}
		}

		if (deletes.length > 0) {
			await this.redisClient.del(...deletes);
			this.logger.info(`Deleted ${deletes.length} inconsistent cache entries`);
		}

		this.logger.info(`Sync summary: ${updates.length} updates, ${deletes.length} deletions`);

		if (updates.length > 0) {
			this.logger.info(`Proceeding to update ${updates.length} database records`);
			await this.batchUpdateSessionsWithTransaction(updates);
			this.logger.info(`Successfully updated ${updates.length} database records`);
		} else {
			this.logger.info('No updates needed - cache and database are in sync');
		}
	}

	private async batchUpdateSessionsWithTransaction(updates: Array<{ token: string; userId: string; lastUsedAt: Date; ip?: Array<{ address: string; count: number; lastSeen: Date }> | null }>): Promise<void> {
		if (updates.length === 0) return;

		await this.userSessionsRepository.manager.transaction(async (manager) => {
			const lastUsedAtCases = updates.map((u, index) =>
				`WHEN token = $${index * 4 + 1} AND "userId" = $${index * 4 + 2} THEN $${index * 4 + 3}`
			).join(' ');

			const ipCases = updates.map((u, index) =>
				`WHEN token = $${index * 4 + 1} AND "userId" = $${index * 4 + 2} THEN $${index * 4 + 4}`
			).join(' ');

			const params: any[] = [];
			const tokenConditions: string[] = [];

			updates.forEach((u, index) => {
				params.push(u.token, u.userId, u.lastUsedAt, JSON.stringify(u.ip));
				tokenConditions.push(`(token = $${index * 4 + 1} AND "userId" = $${index * 4 + 2})`);
			});

			const query = `
				UPDATE user_sessions
				SET
					"lastUsedAt" = CASE ${lastUsedAtCases} ELSE "lastUsedAt" END,
					"ip" = CASE ${ipCases} ELSE "ip" END
				WHERE "isActive" = true
				AND "expiresAt" > NOW()
				AND (${tokenConditions.join(' OR ')})
			`;

			const result = await manager.query(query, params);
			this.logger.info(`Database sync query executed. Result:`, result);

			if (Array.isArray(result) && result.length > 0) {
				this.logger.info(`Database sync: ${result.length} operations completed`);
			} else if (result && typeof result === 'object' && 'affectedRows' in result) {
				this.logger.info(`Database sync: ${result.affectedRows} rows updated`);
			}
		});
	}

	private async processBatchIndividually(keys: string[]): Promise<void> {
		this.logger.info(`Processing ${keys.length} keys individually...`);

		let successCount = 0;
		let failureCount = 0;
		let skippedCount = 0;

		for (const key of keys) {
			const token = key.replace('activeUserSession:', '');
			const lockKey = `operation_lock:${token}`;

			const lockAcquired = await this.redisClient.set(
				lockKey,
				process.pid.toString(),
				'PX',
				UserSessionsService.OPERATION_LOCK_TTL,
				'NX'
			);

			if (!lockAcquired) {
				skippedCount++;
				continue;
			}

			try {
				await this.processBatchSafely([key], [token]);
				successCount++;
			} catch (e) {
				const err = e as Error;
				failureCount++;
				this.logger.warn(`Failed to process ${key}:`, err);
				await this.redisClient.sadd('syncTokenCache:failed_keys', key);
			} finally {
				await this.redisClient.del(lockKey);
			}
		}

		this.logger.info(`Individual processing complete: ${successCount} success, ${failureCount} failures, ${skippedCount} skipped`);
	}

	private async prepareRetry(error: Error, retryCount: number): Promise<void> {
		this.logger.warn(`Preparing retry ${retryCount}, error:`, error);

		if (this.isMemoryError(error)) {
			this.logger.warn('Memory error detected, attempting cleanup...');
			if (global.gc && retryCount <= 2) {
				try {
					global.gc();
					this.logger.info('Manual GC completed');
				} catch (gcError) {
					const err = gcError as Error;
					this.logger.warn('GC failed:', err);
				}
			} else if (retryCount > 2) {
				this.logger.warn('Skipping GC due to high retry count - potential memory leak');
			}
		}
	}

	private async handlePartialFailureRecovery(error: Error, lastProcessedCursor: string, processedCount: number): Promise<void> {
		this.logger.info('Attempting partial recovery...');

		try {
			const recoveryState = {
				timestamp: new Date(),
				error: error.message,
				lastProcessedCursor: lastProcessedCursor || '0',
				partiallyProcessedCount: processedCount || 0
			};

			await this.redisClient.set(
				'syncTokenCache:recovery:lastState',
				JSON.stringify(recoveryState),
				'EX',
				60 * 60 * 24
			);

			await this.cleanupCorruptedData();
			this.logger.info('Recovery state saved, corrupted data cleaned');
		} catch (e) {
			const recoveryErr = e as Error;
			this.logger.error('Recovery failed:', recoveryErr);
		}
	}

	private async cleanupCorruptedData(): Promise<void> {
		const corruptedKeys: string[] = [];
		let cursor = '0';

		do {
			const [nextCursor, keys] = await this.redisClient.scan(
				cursor,
				'MATCH', 'activeUserSession:*',
				'COUNT', '100'
			);
			cursor = nextCursor;

			if (keys.length > 0) {
				const values = await this.redisClient.mget(keys);

				for (let i = 0; i < keys.length; i++) {
					const raw = values[i];
					if (raw) {
						try {
							JSON.parse(raw);
						} catch {
							corruptedKeys.push(keys[i]);
						}
					}
				}
			}
		} while (cursor !== '0' && corruptedKeys.length < 1000);

		if (corruptedKeys.length > 0) {
			await this.redisClient.del(...corruptedKeys);
			this.logger.info(`Cleaned ${corruptedKeys.length} corrupted entries`);
		}
	}

	private isMemoryError(error: Error): boolean {
		return error.message.includes('out of memory') ||
			error.message.includes('Maximum call stack') ||
			error.name === 'RangeError';
	}

	private async performConsistencyCheck(): Promise<void> {
		this.logger.info('Starting data consistency validation...');

		const SAMPLE_SIZE = 100;
		const inconsistencies: Array<{
			token: string;
			cacheData: any;
			dbData: any;
			issue: string;
		}> = [];

		try {
			const sampleTokens = await this.getSampleTokens(SAMPLE_SIZE);

			for (const token of sampleTokens) {
				const result = await this.checkTokenConsistency(token);
				if (result) {
					inconsistencies.push(result);
				}
			}

			await this.generateConsistencyReport(inconsistencies, SAMPLE_SIZE);

			if (inconsistencies.length / SAMPLE_SIZE > 0.1) {
				this.logger.error('High inconsistency rate detected, triggering auto-fix...');
				await this.autoFixInconsistencies(inconsistencies);
			}
		} catch (e) {
			const err = e as Error;
			this.logger.error('Consistency check failed:', err);
		}
	}

	private async checkTokenConsistency(token: string): Promise<{
		token: string;
		cacheData: any;
		dbData: any;
		issue: string;
	} | null> {
		const cacheKey = `activeUserSession:${token}`;
		const cacheData = await this.redisClient.get(cacheKey);

		if (!cacheData) return null;

		let parsedCacheData;
		try {
			parsedCacheData = JSON.parse(cacheData);
		} catch {
			return {
				token,
				cacheData: 'invalid_json',
				dbData: null,
				issue: 'cache_invalid_json'
			};
		}

		const dbSession = await this.userSessionsRepository.findOne({
			where: { token, isActive: true },
			select: ['token', 'userId', 'lastUsedAt', 'expiresAt']
		});

		if (!dbSession) {
			return {
				token,
				cacheData: parsedCacheData,
				dbData: null,
				issue: 'cache_exists_db_missing'
			};
		}

		if (dbSession.expiresAt <= new Date()) {
			return {
				token,
				cacheData: parsedCacheData,
				dbData: dbSession,
				issue: 'db_session_expired'
			};
		}

		if (dbSession.userId !== parsedCacheData.userId) {
			return {
				token,
				cacheData: parsedCacheData,
				dbData: dbSession,
				issue: 'userId_mismatch'
			};
		}

		const timeDiff = Math.abs(
			new Date(parsedCacheData.lastUsedAt).getTime() -
			new Date(dbSession.lastUsedAt).getTime()
		);

		if (timeDiff > 1000 * 60 * 60) {
			return {
				token,
				cacheData: parsedCacheData,
				dbData: dbSession,
				issue: 'timestamp_drift_high'
			};
		}

		return null;
	}

	private async generateConsistencyReport(inconsistencies: any[], sampleSize: number): Promise<void> {
		const report = {
			timestamp: new Date().toISOString(),
			sampleSize,
			totalInconsistencies: inconsistencies.length,
			inconsistencyRate: ((inconsistencies.length / sampleSize) * 100).toFixed(2) + '%',
			issueBreakdown: this.analyzeInconsistencies(inconsistencies),
			examples: inconsistencies.slice(-5)
		};

		if (inconsistencies.length > 0) {
			this.logger.warn(`Found ${inconsistencies.length} inconsistencies:`, report);
		} else {
			this.logger.info('Data consistency validation passed.', report);
		}

		await this.redisClient.set(
			`syncTokenCache:consistency:report:${Date.now()}`,
			JSON.stringify(report),
			'EX',
			60 * 60 * 24 * 3
		);
	}

	private analyzeInconsistencies(inconsistencies: any[]): Record<string, number> {
		const breakdown: Record<string, number> = {};

		for (const item of inconsistencies) {
			breakdown[item.issue] = (breakdown[item.issue] || 0) + 1;
		}

		return breakdown;
	}

	private async autoFixInconsistencies(inconsistencies: any[]): Promise<void> {
		this.logger.info(`Attempting to fix ${inconsistencies.length} inconsistencies...`);

		let fixedCount = 0;

		for (const item of inconsistencies) {
			const lockKey = `operation_lock:${item.token}`;
			const lockAcquired = await this.redisClient.set(
				lockKey,
				process.pid.toString(),
				'PX',
				UserSessionsService.CONSISTENCY_LOCK_TTL,
				'NX'
			);

			if (!lockAcquired) continue;

			try {
				switch (item.issue) {
					case 'cache_invalid_json':
					case 'cache_exists_db_missing':
					case 'db_session_expired':
						await this.redisClient.del(`activeUserSession:${item.token}`);
						fixedCount++;
						break;

					case 'userId_mismatch':
						await this.redisClient.del(`activeUserSession:${item.token}`);
						fixedCount++;
						break;

					case 'timestamp_drift_high':
						if (item.dbData) {
							const cacheData = {
								token: item.dbData.token,
								userId: item.dbData.userId,
								lastUsedAt: item.dbData.lastUsedAt
							};
							await this.redisClient.set(
								`activeUserSession:${item.token}`,
								JSON.stringify(cacheData),
								'PX',
								Math.max(0, item.dbData.expiresAt.getTime() - Date.now())
							);
							fixedCount++;
						}
						break;
				}
			} catch (e) {
				const err = e as Error;
				this.logger.warn(`Failed to fix ${item.token.slice(-5)}:`, err);
			} finally {
				await this.redisClient.del(lockKey);
			}
		}

		this.logger.info(`Fixed ${fixedCount}/${inconsistencies.length} inconsistencies`);
	}

	private async getSampleTokens(sampleSize: number): Promise<string[]> {
		const tokens: string[] = [];
		let cursor = '0';
		let collectedCount = 0;

		do {
			const [nextCursor, keys] = await this.redisClient.scan(
				cursor,
				'MATCH', 'activeUserSession:*',
				'COUNT', '100'
			);
			cursor = nextCursor;

			for (const key of keys) {
				if (collectedCount >= sampleSize) break;

				if (Math.random() < 0.1) {
					const token = key.replace('activeUserSession:', '');
					tokens.push(token);
					collectedCount++;
				}
			}
		} while (cursor !== '0' && collectedCount < sampleSize);

		return tokens;
	}

	@bindThis
	public dispose(): void {
	}

	@bindThis
	public async onApplicationShutdown(signal?: string | undefined): Promise<void> {
		this.dispose();
	}

	public async cleanupAllCacheEntries(): Promise<void> {
		try {
			let cursor = '0';
			let deletedCount = 0;
			const BATCH_SIZE = 100;

			do {
				const [nextCursor, keys] = await this.redisClient.scan(
					cursor,
					'MATCH', 'activeUserSession:*',
					'COUNT', BATCH_SIZE.toString()
				);
				cursor = nextCursor;

				if (keys.length > 0) {
					await this.redisClient.del(...keys);
					deletedCount += keys.length;
				}
			} while (cursor !== '0');

			if (deletedCount > 0) {
				this.logger.info(`Cleaned up ${deletedCount} cache entries during shutdown`);
			}
		} catch (e) {
			const error = e as Error;
			this.logger.warn('Failed to cleanup cache entries:', error);
		}
	}

	@bindThis
	public async listUserSessions(userId: string): Promise<any[]> {
		const sessions = await this.userSessionsRepository.find({
			where: {
				userId,
				isActive: true,
			},
			order: {
				lastUsedAt: 'DESC',
			},
		});

		if (sessions.length === 0) return sessions;

		const cacheKeys = sessions.map(s => `activeUserSession:${s.token}`);
		const cacheValues = await this.redisClient.mget(cacheKeys);

		for (let i = 0; i < sessions.length; i++) {
			const cacheData = cacheValues[i];
			if (cacheData) {
				try {
					const parsed = JSON.parse(cacheData) as ActiveUserSessionCacheData;
					const cacheTime = new Date(parsed.lastUsedAt);
					const dbTime = new Date(sessions[i].lastUsedAt);

					if (cacheTime.getTime() > dbTime.getTime()) {
						sessions[i].lastUsedAt = cacheTime;
					}
				} catch (e) {
					this.logger.warn(`Failed to parse cache for token ${sessions[i].token.slice(-5)}:`, e as Error);
				}
			}
		}

		sessions.sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());

		return sessions;
	}

	public async cleanupAllLocks(): Promise<void> {
		try {
			const locksToClean = [
				'syncTokenCacheWithDatabase:lock',
				'cleanup_expired_tokens:lock',
			];

			for (const lockKey of locksToClean) {
				await this.redisClient.del(lockKey);
			}

			let cursor = '0';
			let deletedLocks = 0;

			do {
				const [nextCursor, keys] = await this.redisClient.scan(
					cursor,
					'MATCH', 'operation_lock:*',
					'COUNT', '50'
				);
				cursor = nextCursor;

				if (keys.length > 0) {
					await this.redisClient.del(...keys);
					deletedLocks += keys.length;
				}
			} while (cursor !== '0');

			cursor = '0';
			do {
				const [nextCursor, keys] = await this.redisClient.scan(
					cursor,
					'MATCH', 'user_operation_lock:*',
					'COUNT', '50'
				);
				cursor = nextCursor;

				if (keys.length > 0) {
					await this.redisClient.del(...keys);
					deletedLocks += keys.length;
				}
			} while (cursor !== '0');

			const stateKeys = [
				'syncTokenCache:recovery:lastState',
				'syncTokenCache:failed_keys',
			];

			for (const key of stateKeys) {
				await this.redisClient.del(key);
			}

			if (deletedLocks > 0) {
				this.logger.info(`Cleaned up ${deletedLocks} locks during shutdown`);
			}
		} catch (e) {
			const error = e as Error;
			this.logger.warn('Failed to cleanup locks:', error);
		}
	}
}
