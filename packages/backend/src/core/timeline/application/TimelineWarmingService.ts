/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { MiMeta, NotesRepository, UsersRepository } from '@/models/_.js';
import { TimelineCache, type TimelineCacheState } from '../domain/TimelineCache.js';
import { WarmingStrategy } from '../domain/WarmingStrategy.js';

/**
 * Timeline Warming Application Service
 *
 * Coordinates the warming process by:
 * - Using domain logic to decide IF/WHEN to warm
 * - Orchestrating infrastructure (Redis, Database)
 * - Managing async operations and queues
 *
 * This service is event-agnostic - it just provides warming operations.
 * Event handlers call this service's methods.
 */
@Injectable()
export class TimelineWarmingService implements OnApplicationShutdown {
	private readonly warmingQueue: Map<string, Promise<void>> = new Map();
	private isShuttingDown = false;
	private readonly warmingStrategy: WarmingStrategy;

	// Metrics
	private stats = {
		totalWarmed: 0,
		totalSkipped: 0,
		totalErrors: 0,
		averageWarmTimeMs: 0,
		lastWarmTime: null as Date | null,
	};

	constructor(
		@Inject(DI.meta)
		private readonly meta: MiMeta,

		@Inject(DI.redis)
		private readonly redisClient: Redis.Redis,

		@Inject(DI.redisForTimelines)
		private readonly redisForTimelines: Redis.Redis,

		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,
	) {
		// Initialize domain strategy with config
		this.warmingStrategy = new WarmingStrategy(
			this.meta.timelineWarmingMinNotes,
			this.meta.timelineWarmingMinFollowers,
			this.meta.timelineWarmingTarget,
		);
	}

	/**
	 * Public API: Warm a user's timeline asynchronously
	 *
	 * This is the main entry point called by event handlers.
	 * Returns immediately, warming happens in background.
	 */
	@bindThis
	async warmTimelineAsync(
		userId: string,
		trigger: 'note_created' | 'user_followed' | 'profile_accessed',
	): Promise<void> {
		// Check if feature is enabled
		if (!this.meta.enableTimelineWarming) return;
		if (this.isShuttingDown) return;

		// Check if already warming
		if (this.warmingQueue.has(userId)) {
			return this.warmingQueue.get(userId)!;
		}

		// Create warming promise (fire-and-forget)
		const warmPromise = this.executeWarming(userId, trigger)
			.finally(() => {
				this.warmingQueue.delete(userId);
			});

		this.warmingQueue.set(userId, warmPromise);

		return warmPromise;
	}

	/**
	 * Core warming execution
	 */
	@bindThis
	private async executeWarming(
		userId: string,
		trigger: 'note_created' | 'user_followed' | 'profile_accessed',
	): Promise<void> {
		const startTime = Date.now();

		try {
			// Step 1: Load user (needed for domain logic)
			const user = await this.usersRepository.findOneBy({ id: userId });
			if (!user || user.host !== null) {
				// Only warm local users
				this.stats.totalSkipped++;
				return;
			}

			// Step 2: Domain decision - should we warm this user?
			const decision = this.warmingStrategy.shouldWarmForUser(user);
			if (!decision.shouldWarm) {
				this.stats.totalSkipped++;
				console.log(`[TimelineWarming] Skipped user ${userId}: ${decision.reason}`);
				return;
			}

			// Step 3: Load current cache state
			const cacheState = await this.loadCacheState(userId);
			const cache = TimelineCache.fromState(cacheState);

			// Step 4: Domain decision - does cache need warming?
			if (!cache.needsWarming()) {
				this.stats.totalSkipped++;
				console.log(`[TimelineWarming] Skipped user ${userId}: cache is fresh`);
				return;
			}

			// Step 5: Calculate how many notes to load
			const toLoad = cache.calculateWarmTarget(decision.targetSize);
			if (toLoad === 0) {
				this.stats.totalSkipped++;
				return;
			}

			console.log(
				`[TimelineWarming] Warming user ${userId}: loading ${toLoad} notes (trigger: ${trigger}, priority: ${decision.priority})`
			);

			// Step 6: Load notes from database
			const noteIds = await this.loadNotesFromDb(userId, cache.oldestNoteId, toLoad);

			if (noteIds.length === 0) {
				console.log(`[TimelineWarming] No notes to load for user ${userId}`);
				return;
			}

			// Step 7: Write to Redis cache
			await this.writeToCache(userId, noteIds, cache.maxSize);

			// Step 8: Mark as warmed
			await this.markAsWarmed(userId);

			// Step 9: Update stats
			const duration = Date.now() - startTime;
			this.stats.totalWarmed++;
			this.stats.lastWarmTime = new Date();
			this.stats.averageWarmTimeMs =
				((this.stats.averageWarmTimeMs * (this.stats.totalWarmed - 1)) + duration) /
				this.stats.totalWarmed;

			console.log(
				`[TimelineWarming] ✓ Warmed ${noteIds.length} notes for user ${userId} in ${duration}ms`
			);
		} catch (error) {
			this.stats.totalErrors++;
			console.error(`[TimelineWarming] ✗ Error warming user ${userId}:`, error);
		}
	}

	/**
	 * Infrastructure: Load current cache state from Redis
	 */
	@bindThis
	private async loadCacheState(userId: string): Promise<TimelineCacheState> {
		const cacheKey = `list:userTimeline:${userId}`;
		const warmKey = `timeline:warm:recent:${userId}`;

		const [cacheLength, oldestId, lastWarmedTs] = await Promise.all([
			this.redisForTimelines.llen(cacheKey),
			this.redisForTimelines.lindex(cacheKey, -1),
			this.redisClient.get(warmKey),
		]);

		return {
			userId,
			currentSize: cacheLength,
			maxSize: this.meta.perLocalUserUserTimelineCacheMax || 300,
			oldestNoteId: oldestId,
			lastWarmedAt: lastWarmedTs ? new Date(parseInt(lastWarmedTs)) : null,
		};
	}

	/**
	 * Infrastructure: Load notes from database
	 */
	@bindThis
	private async loadNotesFromDb(
		userId: string,
		untilId: string | null,
		limit: number,
	): Promise<string[]> {
		const batchSize = 200;
		const noteIds: string[] = [];
		let currentUntilId = untilId;
		let remaining = limit;

		while (remaining > 0) {
			const batch = await this.notesRepository
				.createQueryBuilder('note')
				.select('note.id')
				.where('note.userId = :userId', { userId })
				.andWhere('note.isDeleted = false')
				.andWhere('note.channelId IS NULL') // Match userTimeline logic
				.andWhere(currentUntilId ? 'note.id < :untilId' : '1=1', { untilId: currentUntilId })
				.orderBy('note.id', 'DESC')
				.limit(Math.min(batchSize, remaining))
				.getMany();

			if (batch.length === 0) break;

			noteIds.push(...batch.map(n => n.id));
			remaining -= batch.length;
			currentUntilId = batch[batch.length - 1].id;
		}

		return noteIds;
	}

	/**
	 * Infrastructure: Write notes to Redis cache
	 */
	@bindThis
	private async writeToCache(userId: string, noteIds: string[], maxLen: number): Promise<void> {
		const cacheKey = `list:userTimeline:${userId}`;
		const pipeline = this.redisForTimelines.pipeline();

		// Append to tail (chronologically oldest first)
		for (const noteId of noteIds.reverse()) {
			pipeline.rpush(cacheKey, noteId);
		}

		// Trim to max size
		pipeline.ltrim(cacheKey, 0, maxLen - 1);

		await pipeline.exec();
	}

	/**
	 * Infrastructure: Mark timeline as recently warmed
	 */
	@bindThis
	private async markAsWarmed(userId: string): Promise<void> {
		const warmKey = `timeline:warm:recent:${userId}`;
		await this.redisClient.set(warmKey, Date.now().toString(), 'EX', 3600); // 1 hour
	}

	/**
	 * Public API: Get service statistics
	 */
	@bindThis
	getStats() {
		return {
			...this.stats,
			activeWarmings: this.warmingQueue.size,
			enabled: this.meta.enableTimelineWarming,
			config: {
				target: this.meta.timelineWarmingTarget,
				minNotes: this.meta.timelineWarmingMinNotes,
				minFollowers: this.meta.timelineWarmingMinFollowers,
			},
		};
	}

	/**
	 * Graceful shutdown
	 */
	@bindThis
	async onApplicationShutdown(): Promise<void> {
		this.isShuttingDown = true;

		if (this.warmingQueue.size > 0) {
			console.log(`[TimelineWarming] Waiting for ${this.warmingQueue.size} pending operations...`);

			const timeout = new Promise(resolve => setTimeout(resolve, 10000));
			const allWarms = Promise.all(Array.from(this.warmingQueue.values()));

			await Promise.race([allWarms, timeout]);

			console.log('[TimelineWarming] Shutdown complete');
		}
	}
}
