/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import { pMap } from '@/misc/p-limit.js';
import { RiskScoreAlgorithmsService } from './RiskScoreAlgorithmsService.js';

export interface CacheStrategy {
	ttl: number;
	priority: number;
	maxSize?: number;
	compressionEnabled?: boolean;
}

export interface CachedData<T> {
	data: T;
	timestamp: Date;
	hits: number;
	lastAccess: Date;
	compressed?: boolean;
}

export interface BehaviorSnapshot {
	userId: string;
	timestamp: Date;
	metrics: Record<string, number>;
	hash: string;
}

export interface AntiGamingMetrics {
	suddenChangeScore: number;
	consistencyScore: number;
	velocityScore: number;
	manipulationRisk: number;
	details: string[];
}

@Injectable()
export class RiskScoreCacheService {
	private memoryCache: Map<string, CachedData<any>> = new Map();
	private cacheStats: Map<string, { hits: number; misses: number }> = new Map();
	private readonly MAX_MEMORY_CACHE_SIZE = 10000;

	private readonly cacheStrategies: Record<string, CacheStrategy> = {
		'user-score': { ttl: 3600, priority: 10 },
		'dimension-score': { ttl: 1800, priority: 8 },
		'baseline': { ttl: 7200, priority: 7 },
		'behavior-vector': { ttl: 900, priority: 6 },
		'graph-metrics': { ttl: 3600, priority: 9 },
		'anomaly-detection': { ttl: 600, priority: 5 },
		'historical-snapshot': { ttl: 86400, priority: 3 },
	};

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private algorithmsService: RiskScoreAlgorithmsService,
	) {
		this.initializeService().catch(err => {
			console.error('Failed to initialize RiskScoreCacheService:', err);
		});

		setInterval(() => this.cleanupMemoryCache(), 60000);
		setInterval(() => this.persistImportantCache(), 300000);
	}

	@bindThis
	private async initializeService(): Promise<void> {
		try {
			await this.redisClient.del('risk-score:compute-queue');
			await this.redisClient.zadd('risk-score:compute-queue', 'NX', Date.now(), 'init');

			const initialCacheKeys = [
				'risk-score:config',
				'system:attack-level',
				'system:spam-level',
				'system:health'
			];

			for (const key of initialCacheKeys) {
				const exists = await this.redisClient.exists(key);
				if (!exists) {
					switch (key) {
						case 'system:attack-level':
							await this.redisClient.set(key, '0', 'EX', 86400);
							break;
						case 'system:spam-level':
							await this.redisClient.set(key, '0', 'EX', 86400);
							break;
						case 'system:health':
							await this.redisClient.set(key, '1', 'EX', 86400);
							break;
					}
				}
			}
		} catch (error) {
			console.error('Failed to initialize RiskScoreCacheService:', error);
		}
	}

	@bindThis
	public async get<T>(
		key: string,
		type: string = 'default',
		fetcher?: () => Promise<T>
	): Promise<T | null> {
		const memCached = this.getFromMemory<T>(key);
		if (memCached !== null) {
			this.recordHit(type);
			return memCached;
		}

		const redisCached = await this.getFromRedis<T>(key);
		if (redisCached !== null) {
			this.setToMemory(key, redisCached, type);
			this.recordHit(type);
			return redisCached;
		}

		this.recordMiss(type);
		if (fetcher) {
			const data = await fetcher();
			await this.set(key, data, type);
			return data;
		}

		return null;
	}

	@bindThis
	public async set<T>(
		key: string,
		data: T,
		type: string = 'default'
	): Promise<void> {
		const strategy = this.cacheStrategies[type] || { ttl: 3600, priority: 5 };

		this.setToMemory(key, data, type);

		this.setToRedis(key, data, strategy.ttl).catch(err =>
			console.error(`Failed to set Redis cache for ${key}:`, err)
		);
	}

	@bindThis
	public async batchGet<T>(
		keys: string[]
	): Promise<Map<string, T | null>> {
		const results = new Map<string, T | null>();
		const missingKeys: string[] = [];

		for (const key of keys) {
			const cached = this.getFromMemory<T>(key);
			if (cached !== null) {
				results.set(key, cached);
			} else {
				missingKeys.push(key);
			}
		}

		if (missingKeys.length > 0) {
			const pipeline = this.redisClient.pipeline();
			missingKeys.forEach(key => pipeline.get(key));
			const redisResults = await pipeline.exec();

			if (redisResults) {
				redisResults.forEach((result: [Error | null, unknown], index: number) => {
					if (result && result[0] === null && result[1]) {
						try {
							const data = JSON.parse(result[1] as string);
							results.set(missingKeys[index], data);
							this.setToMemory(missingKeys[index], data, 'default');
						} catch (e) {
							results.set(missingKeys[index], null);
						}
					} else {
						results.set(missingKeys[index], null);
					}
				});
			}
		}

		return results;
	}

	@bindThis
	public async detectGamingBehavior(
		userId: string,
		currentMetrics: Record<string, number>
	): Promise<AntiGamingMetrics> {
		const snapshots = await this.getUserBehaviorSnapshots(userId, 30);

		if (snapshots.length < 7) {
			return {
				suddenChangeScore: 0.5,
				consistencyScore: 0.5,
				velocityScore: 0.5,
				manipulationRisk: 0.5,
				details: ['Insufficient historical data for in-depth analysis'],
			};
		}

		const vectors = snapshots.map(s => Object.values(s.metrics));
		const currentVector = Object.values(currentMetrics);
		const anomalyScore = this.algorithmsService.isolationForest(
			vectors,
			currentVector,
			50,
			Math.min(256, vectors.length)
		);

		const recentSnapshots = snapshots.slice(-7);
		const behaviors = recentSnapshots.map(s => this.behaviorToCategory(s.metrics));
		const currentBehavior = this.behaviorToCategory(currentMetrics);
		behaviors.push(currentBehavior);

		const entropy = this.algorithmsService.calculateEntropy(
			behaviors.map(b => this.hashBehavior(b))
		);
		const consistencyScore = 1 - (entropy / Math.log2(behaviors.length));

		const velocityScore = this.calculateVelocityScore(snapshots, currentMetrics);

		const manipulationPatterns = this.detectManipulationPatterns(snapshots, currentMetrics);

		const manipulationRisk = (
			anomalyScore.score * 0.4 +
			(1 - consistencyScore) * 0.3 +
			velocityScore * 0.3
		);

		const details: string[] = [];
		if (anomalyScore.isAnomaly) details.push('Abnormal behavior patterns detected');
		if (consistencyScore < 0.3) details.push('Lower behavioral consistency');
		if (velocityScore > 0.7) details.push('Abnormal rate of behavioral change');
		if (manipulationPatterns.length > 0) details.push(...manipulationPatterns);

		return {
			suddenChangeScore: anomalyScore.score,
			consistencyScore,
			velocityScore,
			manipulationRisk,
			details,
		};
	}

	@bindThis
	public calculateTimeDecayWeight(
		timestamp: Date,
		halfLife: number = 7
	): number {
		const ageInDays = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
		return Math.pow(0.5, ageInDays / halfLife);
	}

	@bindThis
	public async warmupCache(userIds: string[]): Promise<void> {
		const batchSize = 50;

		for (let i = 0; i < userIds.length; i += batchSize) {
			const batch = userIds.slice(i, i + batchSize);

			await pMap(batch, async userId => {
				const key = `user:risk-score:${userId}`;
				const cached = await this.get(key, 'user-score');

				if (!cached) {
					await this.redisClient.zadd(
						'risk-score:compute-queue',
						Date.now(),
						userId
					);
				}
			}, 10);
		}
	}

	@bindThis
	public async invalidateRelated(userId: string, type: string): Promise<void> {
		const patterns: Record<string, string[]> = {
			'user-update': [
				`user:risk-score:${userId}`,
				`user:dimension:*:${userId}`,
				`user:behavior:${userId}`,
			],
			'social-change': [
				`user:graph:${userId}`,
				`user:social:*:${userId}`,
			],
			'content-change': [
				`user:content:*:${userId}`,
				`user:anomaly:${userId}`,
			],
		};

		const keysToInvalidate = patterns[type] || [`user:*:${userId}`];

		for (const pattern of keysToInvalidate) {
			for (const key of this.memoryCache.keys()) {
				if (this.matchPattern(key, pattern)) {
					this.memoryCache.delete(key);
				}
			}

			const keys = await this.redisClient.keys(pattern);
			if (keys.length > 0) {
				await this.redisClient.del(...keys);
			}
		}
	}

	private getFromMemory<T>(key: string): T | null {
		const cached = this.memoryCache.get(key);
		if (cached) {
			cached.lastAccess = new Date();
			cached.hits++;
			return cached.data as T;
		}
		return null;
	}

	private setToMemory<T>(key: string, data: T, _type: string): void {
		if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
			this.evictLRU();
		}

		this.memoryCache.set(key, {
			data,
			timestamp: new Date(),
			hits: 0,
			lastAccess: new Date(),
		});
	}

	private async getFromRedis<T>(key: string): Promise<T | null> {
		try {
			const cached = await this.redisClient.get(key);
			if (cached) {
				return JSON.parse(cached);
			}
		} catch (e) {
			console.error(`Failed to get from Redis: ${key}`, e);
		}
		return null;
	}

	private async setToRedis<T>(key: string, data: T, ttl: number): Promise<void> {
		try {
			await this.redisClient.set(
				key,
				JSON.stringify(data),
				'EX',
				ttl
			);
		} catch (e) {
			console.error(`Failed to set to Redis: ${key}`, e);
		}
	}

	private evictLRU(): void {
		let lruKey: string | null = null;
		let lruTime = Date.now();

		for (const [key, cached] of this.memoryCache.entries()) {
			if (cached.lastAccess.getTime() < lruTime) {
				lruTime = cached.lastAccess.getTime();
				lruKey = key;
			}
		}

		if (lruKey) {
			this.memoryCache.delete(lruKey);
		}
	}

	private cleanupMemoryCache(): void {
		const now = Date.now();
		const keysToDelete: string[] = [];

		for (const [key, cached] of this.memoryCache.entries()) {
			const age = now - cached.timestamp.getTime();
			if (age > 3600000) {
				keysToDelete.push(key);
			}
		}

		keysToDelete.forEach(key => this.memoryCache.delete(key));
	}

	private async persistImportantCache(): Promise<void> {
		for (const [key, cached] of this.memoryCache.entries()) {
			if (cached.hits > 10) {
				await this.setToRedis(key, cached.data, 7200);
			}
		}
	}

	private recordHit(type: string): void {
		const stats = this.cacheStats.get(type) || { hits: 0, misses: 0 };
		stats.hits++;
		this.cacheStats.set(type, stats);
	}

	private recordMiss(type: string): void {
		const stats = this.cacheStats.get(type) || { hits: 0, misses: 0 };
		stats.misses++;
		this.cacheStats.set(type, stats);
	}

	private async getUserBehaviorSnapshots(
		userId: string,
		days: number
	): Promise<BehaviorSnapshot[]> {
		const key = `user:behavior:history:${userId}`;
		const cached = await this.redisClient.lrange(key, 0, days - 1);

		return cached.map((data: string) => JSON.parse(data));
	}

	private behaviorToCategory(metrics: Record<string, number>): number {
		let category = 0;
		if (metrics.postingFrequency > 0.7) category |= 1;
		if (metrics.followRatio > 0.5) category |= 2;
		if (metrics.interactionRate > 0.6) category |= 4;
		if (metrics.contentDiversity > 0.5) category |= 8;
		return category;
	}

	private hashBehavior(behavior: number): number {
		return behavior % 16;
	}

	private calculateVelocityScore(
		snapshots: BehaviorSnapshot[],
		currentMetrics: Record<string, number>
	): number {
		if (snapshots.length < 2) return 0.5;

		const recentSnapshot = snapshots[snapshots.length - 1];
		const timeDiff = Date.now() - recentSnapshot.timestamp.getTime();
		const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

		let totalChange = 0;
		let count = 0;

		for (const key in currentMetrics) {
			if (key in recentSnapshot.metrics) {
				const change = Math.abs(currentMetrics[key] - recentSnapshot.metrics[key]);
				totalChange += change;
				count++;
			}
		}

		if (count === 0) return 0.5;

		const avgChangePerDay = (totalChange / count) / Math.max(1, daysDiff);

		return Math.min(1, avgChangePerDay * 10);
	}

	private detectManipulationPatterns(
		snapshots: BehaviorSnapshot[],
		currentMetrics: Record<string, number>
	): string[] {
		const patterns: string[] = [];

		const recentActivity = snapshots.slice(-7).map(s => s.metrics.activity || 0);
		const currentActivity = currentMetrics.activity || 0;
		const avgActivity = recentActivity.reduce((a, b) => a + b, 0) / recentActivity.length;

		if (currentActivity > avgActivity * 3) {
			patterns.push('Abnormal surge in activity detected');
		}

		const followChanges = snapshots.slice(-7).map(s => s.metrics.followingCount || 0);
		const variance = this.calculateVariance(followChanges);
		if (variance > 100) {
			patterns.push('Frequent follow/take-down behavior detected');
		}

		const contentTypes = snapshots.slice(-7).map(s => s.metrics.contentType || 0);
		const uniqueTypes = new Set(contentTypes).size;
		if (uniqueTypes > 5) {
			patterns.push('Frequent content type changes detected');
		}

		return patterns;
	}

	private calculateVariance(values: number[]): number {
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
		return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
	}

	private matchPattern(key: string, pattern: string): boolean {
		const regex = pattern
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');
		return new RegExp(`^${regex}$`).test(key);
	}

	@bindThis
	public getCacheStats(): Record<string, any> {
		const stats: Record<string, any> = {};

		for (const [type, stat] of this.cacheStats.entries()) {
			const hitRate = stat.hits / (stat.hits + stat.misses) || 0;
			stats[type] = {
				...stat,
				hitRate: `${(hitRate * 100).toFixed(2)}%`,
			};
		}

		stats.memory = {
			size: this.memoryCache.size,
			maxSize: this.MAX_MEMORY_CACHE_SIZE,
			usage: `${(this.memoryCache.size / this.MAX_MEMORY_CACHE_SIZE * 100).toFixed(2)}%`,
		};

		return stats;
	}
}
