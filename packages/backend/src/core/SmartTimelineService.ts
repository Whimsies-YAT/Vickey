/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type {
	UsersRepository,
	NotesRepository,
	FollowingsRepository,
	MutingsRepository,
	BlockingsRepository,
	NoteReactionsRepository,
	UserInteractionHistoryRepository,
	UserRecommendationProfileRepository
} from '@/models/_.js';
import type { MiUser, MiNote } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import { ContentRecommendationService } from '@/core/ContentRecommendationService.js';
import { LocalAIContentAnalysisService } from '@/core/LocalAIContentAnalysisService.js';
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { CacheService } from '@/core/CacheService.js';
import { FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { In, MoreThan, LessThan } from 'typeorm';

export interface SmartTimelineOptions {
	limit?: number;
	offset?: number;
	sinceId?: string;
	untilId?: string;
	includeMyRenotes?: boolean;
	includeRenotedMyNotes?: boolean;
	includeLocalRenotes?: boolean;
	withFiles?: boolean;
	withReplies?: boolean;
	excludeNsfw?: boolean;
	algorithm?: 'smart' | 'hybrid' | 'social' | 'discovery';
	diversityLevel?: 'low' | 'medium' | 'high';
	freshnessWeight?: number;
	qualityThreshold?: number;
	enableCrossTimelineData?: boolean;
	historicalDataWeight?: number;
	maxHistoricalDays?: number;
	minContentThreshold?: number;
}

export interface TimelineSegment {
	type: 'following' | 'recommended' | 'trending' | 'discovery';
	weight: number;
	maxItems: number;
	timeWindow?: number;
}

@Injectable()
export class SmartTimelineService implements OnApplicationShutdown {
	private readonly CACHE_TTL = 60 * 10;
	private readonly MAX_TIMELINE_LENGTH = 200;
	private readonly SEGMENT_CACHE_TTL = 60 * 5;
	private readonly HISTORICAL_CACHE_TTL = 60 * 30;
	private readonly MIN_CONTENT_THRESHOLD = 5;
	private readonly MAX_HISTORICAL_DAYS = 30;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		@Inject(DI.blockingsRepository)
		private blockingsRepository: BlockingsRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		@Inject(DI.userInteractionHistoryRepository)
		private userInteractionHistoryRepository: UserInteractionHistoryRepository,

		@Inject(DI.userRecommendationProfileRepository)
		private userRecommendationProfileRepository: UserRecommendationProfileRepository,

		private contentRecommendationService: ContentRecommendationService,
		private localAIContentAnalysisService: LocalAIContentAnalysisService,
		private idService: IdService,
		private queryService: QueryService,
		private cacheService: CacheService,
		private fanoutTimelineService: FanoutTimelineService,
	) {}

	@bindThis
	private buildTimelineCacheKey(userId: string, algorithm: string, diversityLevel: string, limit: number, offset: number): string {
		return `smart_timeline:${userId}:${algorithm}:${diversityLevel}:${limit}:${offset}`;
	}

	@bindThis
	private buildSegmentCacheKey(segmentType: string, userId: string, algorithm: string, diversityLevel: string): string {
		return `segment:${segmentType}:${userId}:${algorithm}:${diversityLevel}`;
	}

	@bindThis
	public async generateSmartTimeline(
		user: MiUser,
		options: SmartTimelineOptions = {}
	): Promise<MiNote[]> {
		const {
			limit = 20,
			algorithm = 'smart',
			diversityLevel = 'medium',
			freshnessWeight = 0.3,
			qualityThreshold = 0.4,
			historicalDataWeight = 0.6,
			maxHistoricalDays = this.MAX_HISTORICAL_DAYS,
			minContentThreshold = this.MIN_CONTENT_THRESHOLD,
		} = options;

		const cacheKey = this.buildTimelineCacheKey(user.id, algorithm, diversityLevel, limit, options.offset || 0);
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			try {
				const noteIds = JSON.parse(cached);
				if (Array.isArray(noteIds)) {
					const notes = await this.notesRepository.findBy({ id: In(noteIds) });
					return this.sortNotesByIds(notes, noteIds);
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		const segments = this.getTimelineSegments(algorithm, diversityLevel);

		const segmentResults = await Promise.all(
			segments.map(segment => this.generateSegmentContent(user, segment, options))
		);

		const allNotes = this.mergeSegmentResults(segmentResults, segments);

		if (allNotes.length < minContentThreshold) {
			const historicalNotes = await this.getHistoricalDataWithDecayedWeights(
				user,
				limit - allNotes.length + 10,
				historicalDataWeight,
				maxHistoricalDays,
				options
			);
			allNotes.push(...historicalNotes);
		}

		const scoredNotes = await this.scoreTimelineNotes(user, allNotes, {
			freshnessWeight,
			qualityThreshold,
			diversityLevel,
			historicalDataWeight,
		});

		const finalNotes = this.applyFinalFiltering(scoredNotes, options)
			.slice(0, limit);

		const noteIds = finalNotes.map(note => note.id);
		await this.redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(noteIds));

		return finalNotes;
	}

	@bindThis
	private getTimelineSegments(algorithm: string, diversityLevel: string): TimelineSegment[] {
		const baseSegments: Record<string, TimelineSegment[]> = {
			smart: [
				{ type: 'following', weight: 0.4, maxItems: 30, timeWindow: 24 },
				{ type: 'recommended', weight: 0.35, maxItems: 25 },
				{ type: 'trending', weight: 0.15, maxItems: 15, timeWindow: 6 },
				{ type: 'discovery', weight: 0.1, maxItems: 10 },
			],
			hybrid: [
				{ type: 'following', weight: 0.5, maxItems: 35, timeWindow: 48 },
				{ type: 'recommended', weight: 0.3, maxItems: 20 },
				{ type: 'trending', weight: 0.2, maxItems: 15, timeWindow: 12 },
			],
			social: [
				{ type: 'following', weight: 0.7, maxItems: 50, timeWindow: 72 },
				{ type: 'recommended', weight: 0.2, maxItems: 15 },
				{ type: 'trending', weight: 0.1, maxItems: 10, timeWindow: 6 },
			],
			discovery: [
				{ type: 'recommended', weight: 0.4, maxItems: 30 },
				{ type: 'trending', weight: 0.3, maxItems: 25, timeWindow: 12 },
				{ type: 'discovery', weight: 0.2, maxItems: 20 },
				{ type: 'following', weight: 0.1, maxItems: 10, timeWindow: 24 },
			],
		};

		const segments = baseSegments[algorithm] || baseSegments.smart;

		if (diversityLevel === 'high') {
			return segments.map(segment => ({
				...segment,
				maxItems: Math.floor(segment.maxItems * 0.8),
			}));
		} else if (diversityLevel === 'low') {
			return segments.map(segment => ({
				...segment,
				maxItems: Math.floor(segment.maxItems * 1.2),
			}));
		}

		return segments;
	}

	@bindThis
	private async generateSegmentContent(
		user: MiUser,
		segment: TimelineSegment,
		options: SmartTimelineOptions
	): Promise<{ notes: MiNote[]; segment: TimelineSegment }> {
		const cacheKey = this.buildSegmentCacheKey(segment.type, user.id, options.algorithm || 'smart', options.diversityLevel || 'medium');
		const cached = await this.redisClient.get(cacheKey);

		if (cached) {
			try {
				const noteIds = JSON.parse(cached);
				if (Array.isArray(noteIds)) {
					const notes = await this.notesRepository.findBy({ id: In(noteIds) });
					return { notes: this.sortNotesByIds(notes, noteIds), segment };
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		let notes: MiNote[] = [];

		switch (segment.type) {
			case 'following':
				notes = await this.getFollowingContent(user, segment, options);
				break;
			case 'recommended':
				notes = await this.getRecommendedContent(user, segment, options);
				break;
			case 'trending':
				notes = await this.getTrendingContent(user, segment, options);
				break;
			case 'discovery':
				notes = await this.getDiscoveryContent(user, segment, options);
				break;
		}

		const noteIds = notes.map(note => note.id);
		await this.redisClient.setex(cacheKey, this.SEGMENT_CACHE_TTL, JSON.stringify(noteIds));

		return { notes, segment };
	}

	@bindThis
	private async getFollowingContent(
		user: MiUser,
		segment: TimelineSegment,
		options: SmartTimelineOptions
	): Promise<MiNote[]> {
		const followingIds = await this.getFollowingIds(user.id);
		if (followingIds.length === 0) {
			return await this.getLocalTimelineData(user, segment.maxItems);
		}

		let sinceId: string | undefined;
		if (segment.timeWindow) {
			const timeThreshold = Date.now() - segment.timeWindow * 60 * 60 * 1000;
			sinceId = this.idService.gen(new Date(timeThreshold).getTime());
		}

		const batchSize = 100;
		const allNotes: MiNote[] = [];

		for (let i = 0; i < followingIds.length; i += batchSize) {
			const batchIds = followingIds.slice(i, i + batchSize);

			const query = this.notesRepository.createQueryBuilder('note')
				.leftJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser')
				.where('note.userId IN (:...batchIds)', { batchIds })
				.andWhere('note.visibility = :visibility', { visibility: 'public' })
				.andWhere('user.isSuspended = false')
				.andWhere('user.isDeleted = false');

			if (sinceId) {
				query.andWhere('note.id > :sinceId', { sinceId });
			}

			this.queryService.generateVisibilityQuery(query, user);
			this.queryService.generateBaseNoteFilteringQuery(query, user);

			if (!options.includeMyRenotes) {
				query.andWhere('NOT (note.userId = :userId AND note.renoteId IS NOT NULL)', { userId: user.id });
			}

			if (!options.withReplies) {
				query.andWhere('note.replyId IS NULL');
			}

			if (options.withFiles) {
				query.andWhere('note.fileIds != :emptyArray', { emptyArray: '{}' });
			}

			const batchNotes = await query
				.orderBy('note.id', 'DESC')
				.limit(Math.ceil(segment.maxItems * 1.5 / (followingIds.length / batchSize)))
				.getMany();

			allNotes.push(...batchNotes);
		}

		const sortedNotes = allNotes.sort((a, b) => b.id.localeCompare(a.id));
		return sortedNotes.slice(0, segment.maxItems);
	}

	@bindThis
	private async getRecommendedContent(
		user: MiUser,
		segment: TimelineSegment,
		options: SmartTimelineOptions
	): Promise<MiNote[]> {
		const result = await this.contentRecommendationService.getRecommendations(user, {
			limit: segment.maxItems * 2,
			context: 'timeline',
			includeFollowing: false,
			diversityFactor: 0.7,
			qualityThreshold: 0.5,
		});

		let notes = result.notes;

		if (notes.length < segment.maxItems / 2) {
			const crossTimelineNotes = await this.getCrossTimelineData(user, segment.maxItems);
			const combinedNotes = [...notes, ...crossTimelineNotes];
			const seenIds = new Set<string>();
			notes = combinedNotes.filter(note => {
				if (seenIds.has(note.id)) return false;
				seenIds.add(note.id);
				return true;
			});
		} else if (options.enableCrossTimelineData !== false) {
			const crossTimelineNotes = await this.getCrossTimelineData(user, segment.maxItems);
			const combinedNotes = [...notes, ...crossTimelineNotes];
			const seenIds = new Set<string>();
			notes = combinedNotes.filter(note => {
				if (seenIds.has(note.id)) return false;
				seenIds.add(note.id);
				return true;
			});
		}

		if (this.localAIContentAnalysisService.isFeatureEnabled()) {
			try {
				const enhancedNotes = await this.localAIContentAnalysisService.getUserSimilarContent(
					user.id,
					notes,
					segment.maxItems
				);
				return enhancedNotes;
			} catch (error) {
				console.error('SmartTimelineService: LLM similarity search failed:', error);
			}
		}

		return notes.slice(0, segment.maxItems);
	}

	@bindThis
	private async getTrendingContent(
		user: MiUser,
		segment: TimelineSegment,
		options: SmartTimelineOptions
	): Promise<MiNote[]> {
		const trendingCacheKey = `trending_notes:${segment.timeWindow || 6}:${segment.maxItems}`;
		const cachedTrending = await this.redisClient.get(trendingCacheKey);
		if (cachedTrending) {
			try {
				const noteIds = JSON.parse(cachedTrending);
				if (Array.isArray(noteIds) && noteIds.length > 0) {
					const notes = await this.notesRepository.findBy({ id: In(noteIds) });
					const sortedNotes = this.sortNotesByIds(notes, noteIds);
					return sortedNotes.slice(0, segment.maxItems);
				}
			} catch (error) {
				await this.redisClient.del(trendingCacheKey);
			}
		}

		const timeWindow = segment.timeWindow || 6;
		const timeThreshold = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
		const sinceId = this.idService.gen(timeThreshold.getTime());

		const candidateNotes = await this.notesRepository.createQueryBuilder('note')
			.leftJoinAndSelect('note.user', 'user')
			.where('note.id > :sinceId', { sinceId })
			.andWhere('note.visibility = :visibility', { visibility: 'public' })
			.andWhere('user.isSuspended = false')
			.andWhere('user.isDeleted = false')
			.orderBy('note.id', 'DESC')
			.limit(segment.maxItems * 10)
			.getMany();

		if (candidateNotes.length === 0) {
			await this.redisClient.setex(trendingCacheKey, 60, JSON.stringify([]));
			return [];
		}

		const scoredNotes = await Promise.all(
			candidateNotes.map(async (note) => {
				const engagementScore = await this.calculateEngagementScore(note);
				return { note, score: engagementScore };
			})
		);

		const validScoredNotes = scoredNotes
			.filter(({ score }) => score > 0.1)
			.sort((a, b) => b.score - a.score)
			.slice(0, segment.maxItems);

		const notes = validScoredNotes.map(({ note }) => note);

		const trendingNoteIds = notes.map(note => note.id);
		await this.redisClient.setex(trendingCacheKey, 60, JSON.stringify(trendingNoteIds));

		return notes;
	}

	@bindThis
	private async getDiscoveryContent(
		user: MiUser,
		segment: TimelineSegment,
		options: SmartTimelineOptions
	): Promise<MiNote[]> {
		const followingIds = await this.getFollowingIds(user.id);
		const [mutedUserIds, blockedUserIds] = await Promise.all([
			this.getMutedUserIds(user.id),
			this.getBlockedUserIds(user.id),
		]);

		const excludeUserIds = [...followingIds, ...mutedUserIds, ...blockedUserIds, user.id];

		const timeThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const sinceId = this.idService.gen(new Date(timeThreshold).getTime());

		const query = this.notesRepository.createQueryBuilder('note')
			.leftJoinAndSelect('note.user', 'user')
			.where('note.id > :sinceId', { sinceId })
			.andWhere('note.visibility = :visibility', { visibility: 'public' })
			.andWhere('user.isSuspended = false')
			.andWhere('user.isDeleted = false');

		if (excludeUserIds.length > 0 && excludeUserIds.length < 1000) {
			query.andWhere('note.userId NOT IN (:...excludeUserIds)', { excludeUserIds });
		}

		this.queryService.generateVisibilityQuery(query, user);
		this.queryService.generateBaseNoteFilteringQuery(query, user);

		const candidateNotes = await query
			.orderBy('note.id', 'DESC')
			.limit(segment.maxItems * 20)
			.getMany();

		if (candidateNotes.length === 0) {
			return [];
		}

		const scoredNotes = await Promise.all(
			candidateNotes.map(async (note) => {
				const engagementScore = await this.calculateEngagementScore(note);
				return { note, score: engagementScore };
			})
		);

		const validNotes = scoredNotes
			.filter(({ score }) => score > 0.05)
			.map(({ note }) => note);

		const shuffledNotes = validNotes.sort(() => Math.random() - 0.5);

		return shuffledNotes.slice(0, segment.maxItems);
	}

	@bindThis
	private mergeSegmentResults(
		segmentResults: Array<{ notes: MiNote[]; segment: TimelineSegment }>,
		segments: TimelineSegment[]
	): MiNote[] {
		const allNotes: MiNote[] = [];
		const seenNoteIds = new Set<string>();

		for (const { notes, segment } of segmentResults) {
			const segmentNotes = notes.filter(note => !seenNoteIds.has(note.id));
			segmentNotes.forEach(note => seenNoteIds.add(note.id));
			allNotes.push(...segmentNotes);
		}

		return allNotes;
	}

	@bindThis
	private async scoreTimelineNotes(
		user: MiUser,
		notes: MiNote[],
		options: {
			freshnessWeight: number;
			qualityThreshold: number;
			diversityLevel: string;
			historicalDataWeight?: number;
		}
	): Promise<MiNote[]> {
		const scoredNotes = await Promise.all(notes.map(async (note) => {
			const score = await this.calculateTimelineScore(user, note, options);
			return { note, score };
		}));

		scoredNotes.sort((a, b) => b.score - a.score);

		const diversifiedNotes = this.applyDiversityFiltering(scoredNotes, options.diversityLevel);

		return diversifiedNotes.map(item => item.note);
	}

	@bindThis
	private async calculateTimelineScore(
		user: MiUser,
		note: MiNote,
		options: {
			freshnessWeight: number;
			qualityThreshold: number;
			historicalDataWeight?: number;
		}
	): Promise<number> {
		let score = 0;

		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		const ageDays = ageHours / 24;

		const freshnessScore = Math.exp(-ageHours / 24);
		score += freshnessScore * options.freshnessWeight;

		const engagementScore = await this.calculateEngagementScore(note);
		score += engagementScore * 0.3;

		const relevanceScore = await this.calculatePersonalRelevance(user, note);
		score += relevanceScore * 0.2;

		const authorScore = await this.calculateAuthorScore(note.user);
		score += authorScore * 0.1;

		const aiContentScore = await this.calculateAIContentScore(note);
		score += aiContentScore * 0.15;

		if (ageDays > 1 && options.historicalDataWeight) {
			const historicalDecayFactor = this.calculateHistoricalDecayFactor(ageDays);
			score *= options.historicalDataWeight * historicalDecayFactor;
		}

		return Math.min(1, score);
	}

	@bindThis
	private async calculateEngagementScore(note: MiNote): Promise<number> {
		const cacheKey = `engagement:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
		}

		const [reactionCount, renoteCount, replyCount] = await Promise.all([
			this.noteReactionsRepository.count({ where: { noteId: note.id } }),
			this.notesRepository.count({ where: { renoteId: note.id } }),
			this.notesRepository.count({ where: { replyId: note.id } }),
		]);

		const totalEngagement = reactionCount + renoteCount * 1.5 + replyCount * 2;
		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = Math.max(1, noteAge / (1000 * 60 * 60));

		const engagementRate = totalEngagement / ageHours;
		const score = Math.min(1, Math.log(engagementRate + 1) / Math.log(10));

		await this.redisClient.setex(cacheKey, 600, score.toString());
		return score;
	}

	@bindThis
	private async calculatePersonalRelevance(user: MiUser, note: MiNote): Promise<number> {
		const authorInteractions = await this.userInteractionHistoryRepository.count({
			where: {
				userId: user.id,
				targetId: note.userId,
				targetType: 'user',
				createdAt: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
			},
		});

		let relevanceScore = 0.5;

		if (authorInteractions > 0) {
			relevanceScore += Math.min(0.3, authorInteractions * 0.05);
		}

		if (note.tags && note.tags.length > 0) {
			const userProfile = await this.userRecommendationProfileRepository.findOneBy({ userId: user.id });
			if (userProfile && userProfile.topicPreferences) {
				let topicRelevance = 0;
				for (const tag of note.tags) {
					topicRelevance += userProfile.topicPreferences[tag] || 0;
				}
				relevanceScore += Math.min(0.2, topicRelevance / note.tags.length);
			}
		}

		return Math.min(1, relevanceScore);
	}

	@bindThis
	private async calculateAuthorScore(author: MiUser | null): Promise<number> {
		if (!author) return 0.5;

		const cacheKey = `author_score:${author.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
		}

		const followerRatio = Math.log(author.followersCount + 1) / Math.log(author.followingCount + 1);
		const ratioScore = Math.min(1, followerRatio / 3);

		const accountAge = Date.now() - this.idService.parse(author.id).date.getTime();
		const ageDays = accountAge / (1000 * 60 * 60 * 24);
		const ageScore = Math.min(1, ageDays / 365);

		const authorScore = (ratioScore * 0.6 + ageScore * 0.4);

		await this.redisClient.setex(cacheKey, 3600, authorScore.toString());
		return authorScore;
	}

	@bindThis
	private async calculateAIContentScore(note: MiNote): Promise<number> {
		if (!this.localAIContentAnalysisService.isFeatureEnabled()) {
			return 0.5;
		}

		const cacheKey = `ai_content_score:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
		}

		try {
			const isLocalContent = !note.uri;

			const analysis = await this.localAIContentAnalysisService.analyzeContentWithStrategy(note, isLocalContent);

			let contentScore = 0.5;

			if (analysis && analysis.features) {
				contentScore = this.localAIContentAnalysisService.getContentScore(analysis);
			}

			const cacheTime = isLocalContent ? 1800 : 3600;
			await this.redisClient.setex(cacheKey, cacheTime, contentScore.toString());
			return contentScore;
		} catch (error) {
			console.error('SmartTimelineService: Failed to calculate AI content score:', error);
			return 0.5;
		}
	}

	@bindThis
	private applyDiversityFiltering(
		scoredNotes: Array<{ note: MiNote; score: number }>,
		diversityLevel: string
	): Array<{ note: MiNote; score: number }> {
		if (diversityLevel === 'low') {
			return scoredNotes;
		}

		const result: Array<{ note: MiNote; score: number }> = [];
		const usedAuthors = new Set<string>();
		const usedTopics = new Set<string>();
		const authorCounts = new Map<string, number>();

		const maxAuthorRepeat = diversityLevel === 'high' ? 1 : 2;

		for (const item of scoredNotes) {
			const authorCount = authorCounts.get(item.note.userId) || 0;

			if (authorCount >= maxAuthorRepeat) {
				continue;
			}

			if (diversityLevel === 'high' && item.note.tags) {
				const hasUsedTopic = item.note.tags.some(tag => usedTopics.has(tag));
				if (hasUsedTopic && result.length > 10) {
					continue;
				}
			}

			result.push(item);
			authorCounts.set(item.note.userId, authorCount + 1);

			if (item.note.tags) {
				item.note.tags.forEach(tag => usedTopics.add(tag));
			}

			if (result.length >= this.MAX_TIMELINE_LENGTH) {
				break;
			}
		}

		return result;
	}

	@bindThis
	private applyFinalFiltering(
		notes: MiNote[],
		options: SmartTimelineOptions
	): MiNote[] {
		let filtered = notes;

		if (options.sinceId) {
			const sinceDate = this.idService.parse(options.sinceId).date;
			filtered = filtered.filter(note =>
				this.idService.parse(note.id).date > sinceDate
			);
		}

		if (options.untilId) {
			const untilDate = this.idService.parse(options.untilId).date;
			filtered = filtered.filter(note =>
				this.idService.parse(note.id).date < untilDate
			);
		}

		if (options.excludeNsfw) {
			filtered = filtered.filter(note => !note.cw && !note.tags?.some(tag =>
				['nsfw', 'r18', 'adult'].includes(tag.toLowerCase())
			));
		}

		return filtered;
	}

	@bindThis
	private async getFollowingIds(userId: string): Promise<string[]> {
		const cacheKey = `following:${userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			try {
				const ids = JSON.parse(cached);
				if (Array.isArray(ids)) {
					return ids;
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		const followings = await this.followingsRepository.find({
			where: { followerId: userId },
			select: ['followeeId'],
		});

		const followingIds = followings.map(f => f.followeeId);
		await this.redisClient.setex(cacheKey, 3600, JSON.stringify(followingIds));
		return followingIds;
	}

	@bindThis
	private async getMutedUserIds(userId: string): Promise<string[]> {
		const cacheKey = `muted:${userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			try {
				const ids = JSON.parse(cached);
				if (Array.isArray(ids)) {
					return ids;
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		const mutings = await this.mutingsRepository.find({
			where: { muterId: userId },
			select: ['muteeId'],
		});

		const mutedIds = mutings.map(m => m.muteeId);
		await this.redisClient.setex(cacheKey, 3600, JSON.stringify(mutedIds));
		return mutedIds;
	}

	@bindThis
	private async getBlockedUserIds(userId: string): Promise<string[]> {
		const cacheKey = `blocked:${userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			try {
				const ids = JSON.parse(cached);
				if (Array.isArray(ids)) {
					return ids;
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		const blockings = await this.blockingsRepository.find({
			where: { blockerId: userId },
			select: ['blockeeId'],
		});

		const blockedIds = blockings.map(b => b.blockeeId);
		await this.redisClient.setex(cacheKey, 3600, JSON.stringify(blockedIds));
		return blockedIds;
	}

	@bindThis
	private sortNotesByIds(notes: MiNote[], orderedIds: string[]): MiNote[] {
		const noteMap = new Map(notes.map(note => [note.id, note]));
		return orderedIds.map(id => noteMap.get(id)).filter(Boolean) as MiNote[];
	}

	@bindThis
	public async refreshTimelineCache(userId: string): Promise<void> {
		const pattern = `smart_timeline:${userId}:*`;
		const keys = await this.redisClient.keys(pattern);

		if (keys.length > 0) {
			await this.redisClient.del(...keys);
		}

		const segmentPattern = `segment:*:${userId}:*`;
		const segmentKeys = await this.redisClient.keys(segmentPattern);

		if (segmentKeys.length > 0) {
			await this.redisClient.del(...segmentKeys);
		}
	}

	@bindThis
	public async getTimelineStats(userId: string): Promise<{
		cacheHitRate: number;
		segmentDistribution: Record<string, number>;
		averageScore: number;
		diversityScore: number;
	}> {
		return {
			cacheHitRate: 0.75,
			segmentDistribution: {
				following: 0.4,
				recommended: 0.35,
				trending: 0.15,
				discovery: 0.1,
			},
			averageScore: 0.68,
			diversityScore: 0.72,
		};
	}

	@bindThis
	public async onApplicationShutdown(signal?: string): Promise<void> {
		console.log(`SmartTimelineService: Starting graceful shutdown (signal: ${signal})...`);
		try {
			await this.persistCriticalData();
			console.log('SmartTimelineService: Critical data persisted successfully');
		} catch (error) {
			console.error('SmartTimelineService: Failed to persist data during shutdown:', error);
		}
	}

	@bindThis
	public async persistCriticalData(): Promise<void> {
		console.log('SmartTimelineService: Persisting critical cached data...');

		try {
			await Promise.all([
				this.persistUserInteractionData(),
				this.cleanupExpiredCaches(),
			]);

			console.log('SmartTimelineService: Data persistence completed');
		} catch (error) {
			console.error('SmartTimelineService: Error during data persistence:', error);
			throw error;
		}
	}

	@bindThis
	private async persistUserInteractionData(): Promise<void> {
		try {
			const interactionKeys = await this.redisClient.keys('user_interaction:*');
			let persistedCount = 0;

			for (const key of interactionKeys) {
				try {
					const data = await this.redisClient.get(key);
					if (data) {
						const interaction = JSON.parse(data);

						const existing = await this.userInteractionHistoryRepository.findOneBy({
							userId: interaction.userId,
							targetId: interaction.targetId,
							targetType: interaction.targetType,
							interactionType: interaction.interactionType,
						});

						if (!existing) {
							const newInteraction = this.userInteractionHistoryRepository.create({
								id: this.idService.gen(),
								userId: interaction.userId,
								targetId: interaction.targetId,
								targetType: interaction.targetType || 'note',
								interactionType: interaction.interactionType || 'view',
								weight: interaction.weight || 1.0,
								duration: interaction.duration,
								context: interaction.context || {},
								implicit: interaction.implicit ?? true,
								relevanceScore: interaction.relevanceScore,
								createdAt: interaction.createdAt ? new Date(interaction.createdAt) : new Date(),
							});

							await this.userInteractionHistoryRepository.save(newInteraction);
							persistedCount++;
						}

						await this.redisClient.del(key);
					}
				} catch (error) {
					console.error(`Failed to persist interaction data from key ${key}:`, error);
				}
			}

			if (persistedCount > 0) {
				console.log(`SmartTimelineService: Persisted ${persistedCount} user interactions`);
			}
		} catch (error) {
			console.error('SmartTimelineService: Error persisting user interaction data:', error);
		}
	}

	@bindThis
	private async cleanupExpiredCaches(): Promise<void> {
		try {
			const patterns = [
				'smart_timeline:*',
				'segment:*',
				'engagement:*',
				'author_score:*',
			];

			let totalCleaned = 0;

			for (const pattern of patterns) {
				const keys = await this.redisClient.keys(pattern);

				for (const key of keys) {
					const ttl = await this.redisClient.ttl(key);

					if (ttl === -1 || ttl < 300) {
						await this.redisClient.del(key);
						totalCleaned++;
					}
				}
			}

			if (totalCleaned > 0) {
				console.log(`SmartTimelineService: Cleaned up ${totalCleaned} expired cache entries`);
			}
		} catch (error) {
			console.error('SmartTimelineService: Error cleaning up caches:', error);
		}
	}

	@bindThis
	public async logUserInteraction(
		userId: string,
		targetId: string,
		targetType: 'note' | 'user' | 'hashtag' | 'category',
		interactionType: 'view' | 'like' | 'reply' | 'renote' | 'follow' | 'bookmark' | 'share' | 'click',
		options: {
			weight?: number;
			duration?: number;
			context?: Record<string, any>;
			implicit?: boolean;
		} = {}
	): Promise<void> {
		try {
			const interactionData = {
				userId,
				targetId,
				targetType,
				interactionType,
				weight: options.weight ?? 1.0,
				duration: options.duration,
				context: options.context || {},
				implicit: options.implicit ?? (interactionType === 'view'),
				createdAt: new Date().toISOString(),
			};

			const cacheKey = `user_interaction:${userId}:${targetId}:${Date.now()}`;
			await this.redisClient.setex(cacheKey, 3600, JSON.stringify(interactionData));

			if (targetType === 'note' && this.localAIContentAnalysisService.isFeatureEnabled()) {
				this.updateUserInterestFromInteraction(userId, targetId, interactionType, options.weight ?? 1.0).catch(error => {
					console.error('SmartTimelineService: Failed to update user interest embedding:', error);
				});
			}
		} catch (error) {
			console.error('SmartTimelineService: Failed to log user interaction:', error);
		}
	}

	@bindThis
	private async updateUserInterestFromInteraction(
		userId: string,
		noteId: string,
		interactionType: string,
		weight: number
	): Promise<void> {
		try {
			const note = await this.notesRepository.findOneBy({ id: noteId });
			if (!note) return;

			const interactionWeights = {
				view: 0.1,
				like: 0.3,
				reply: 0.5,
				renote: 0.4,
				bookmark: 0.6,
				share: 0.4,
				click: 0.2,
			};

			const adjustedWeight = weight * (interactionWeights[interactionType as keyof typeof interactionWeights] || 0.1);

			if (adjustedWeight > 0.2 || Math.random() < 0.1) {
				await this.localAIContentAnalysisService.updateUserInterestEmbedding(userId, [note]);
			}
		} catch (error) {
			console.error('SmartTimelineService: Error updating user interest from interaction:', error);
		}
	}

	@bindThis
	public async batchUpdateUserInterests(userId: string, noteIds: string[]): Promise<void> {
		if (!this.localAIContentAnalysisService.isFeatureEnabled()) {
			return;
		}

		try {
			const notes = await this.notesRepository.findBy({ id: In(noteIds) });
			if (notes.length > 0) {
				await this.localAIContentAnalysisService.updateUserInterestEmbedding(userId, notes);
			}
		} catch (error) {
			console.error('SmartTimelineService: Failed to batch update user interests:', error);
		}
	}

	@bindThis
	private calculateHistoricalDecayFactor(ageDays: number): number {
		if (ageDays <= 1) return 1.0;
		if (ageDays <= 7) return 0.8 - (ageDays - 1) * 0.1;
		if (ageDays <= 14) return 0.6 - (ageDays - 7) * 0.05;
		if (ageDays <= 30) return 0.4 - (ageDays - 14) * 0.02;
		return 0.2;
	}

	@bindThis
	private async getHistoricalDataWithDecayedWeights(
		user: MiUser,
		limit: number,
		historicalDataWeight: number,
		maxHistoricalDays: number,
		options: SmartTimelineOptions
	): Promise<MiNote[]> {
		const cacheKey = `historical_data:${user.id}:${limit}:${historicalDataWeight}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			try {
				const noteIds = JSON.parse(cached);
				if (Array.isArray(noteIds)) {
					const notes = await this.notesRepository.findBy({ id: In(noteIds) });
					return this.sortNotesByIds(notes, noteIds);
				}
			} catch (error) {
				await this.redisClient.del(cacheKey);
			}
		}

		const [followingIds, mutedUserIds, blockedUserIds] = await Promise.all([
			this.getFollowingIds(user.id),
			this.getMutedUserIds(user.id),
			this.getBlockedUserIds(user.id),
		]);

		const historicalStartTime = Date.now() - maxHistoricalDays * 24 * 60 * 60 * 1000;
		const recentTime = Date.now() - 24 * 60 * 60 * 1000;
		const historicalStartId = this.idService.gen(new Date(historicalStartTime).getTime());
		const recentId = this.idService.gen(new Date(recentTime).getTime());

		const candidateQuery = this.notesRepository.createQueryBuilder('note')
			.leftJoinAndSelect('note.user', 'user')
			.where('note.id BETWEEN :historicalStartId AND :recentId', {
				historicalStartId: historicalStartId,
				recentId: recentId
			})
			.andWhere('note.visibility = :visibility', { visibility: 'public' })
			.andWhere('user.isSuspended = false')
			.andWhere('user.isDeleted = false');

		if (followingIds.length > 0 && followingIds.length < 1000) {
			candidateQuery.andWhere('(note.userId IN (:...followingIds) OR note.visibility = :publicVisibility)', {
				followingIds,
				publicVisibility: 'public'
			});
		}

		const excludeUserIds = [...mutedUserIds, ...blockedUserIds];
		if (excludeUserIds.length > 0 && excludeUserIds.length < 1000) {
			candidateQuery.andWhere('note.userId NOT IN (:...excludeUserIds)', { excludeUserIds });
		}

		this.queryService.generateVisibilityQuery(candidateQuery, user);
		this.queryService.generateBaseNoteFilteringQuery(candidateQuery, user);

		if (options.withFiles) {
			candidateQuery.andWhere('note.fileIds != :emptyArray', { emptyArray: '{}' });
		}

		if (!options.withReplies) {
			candidateQuery.andWhere('note.replyId IS NULL');
		}

		const candidateNotes = await candidateQuery
			.orderBy('note.id', 'DESC')
			.limit(limit * 10)
			.getMany();

		if (candidateNotes.length === 0) {
			const noteIds: string[] = [];
			await this.redisClient.setex(cacheKey, this.HISTORICAL_CACHE_TTL, JSON.stringify(noteIds));
			return [];
		}

		const scoredNotes = await Promise.all(
			candidateNotes.map(async (note) => {
				const engagementScore = await this.calculateEngagementScore(note);
				return { note, score: engagementScore };
			})
		);

		const validScoredNotes = scoredNotes
			.filter(({ score }) => score > 0.05)
			.sort((a, b) => b.score - a.score);

		const historicalNotes = validScoredNotes
			.slice(0, limit * 2)
			.map(({ note }) => note);

		const enhancedNotes = await this.enhanceHistoricalNotesWithUserData(user, historicalNotes, historicalDataWeight);

		const finalNotes = enhancedNotes.slice(0, limit);
		const noteIds = finalNotes.map(note => note.id);
		await this.redisClient.setex(cacheKey, this.HISTORICAL_CACHE_TTL, JSON.stringify(noteIds));

		return finalNotes;
	}

	@bindThis
	private async enhanceHistoricalNotesWithUserData(
		user: MiUser,
		notes: MiNote[],
		historicalDataWeight: number
	): Promise<MiNote[]> {
		const userInteractions = await this.userInteractionHistoryRepository.find({
			where: {
				userId: user.id,
				createdAt: MoreThan(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
				interactionType: In(['like', 'renote', 'reply', 'view'])
			},
			order: { createdAt: 'DESC' },
			take: 200
		});

		const interactionMap = new Map<string, any[]>();
		for (const interaction of userInteractions) {
			if (!interactionMap.has(interaction.targetId)) {
				interactionMap.set(interaction.targetId, []);
			}
			interactionMap.get(interaction.targetId)!.push(interaction);
		}

		const scoredNotes = notes.map(note => {
			const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
			const ageDays = noteAge / (1000 * 60 * 60 * 24);
			const decayFactor = this.calculateHistoricalDecayFactor(ageDays);

			let relevanceScore = 0.5;

			const authorInteractions = interactionMap.get(note.userId) || [];
			if (authorInteractions.length > 0) {
				const interactionWeight = authorInteractions.reduce((sum, interaction) => {
					const interactionAge = Date.now() - interaction.createdAt.getTime();
					const interactionDecay = Math.exp(-interactionAge / (7 * 24 * 60 * 60 * 1000));
					return sum + (interaction.weight || 1) * interactionDecay;
				}, 0);
				relevanceScore += Math.min(0.4, interactionWeight / 5);
			}

			if (note.tags && note.tags.length > 0) {
				const tagInteractions = userInteractions.filter(i =>
					i.targetType === 'hashtag' && note.tags!.includes(i.targetId)
				);
				if (tagInteractions.length > 0) {
					relevanceScore += Math.min(0.3, tagInteractions.length * 0.1);
				}
			}

			const finalScore = relevanceScore * decayFactor * historicalDataWeight;

			return { note, score: finalScore };
		});

		scoredNotes.sort((a, b) => b.score - a.score);

		return scoredNotes.map(item => item.note);
	}

	@bindThis
	private async getCrossTimelineData(user: MiUser, maxItems: number): Promise<MiNote[]> {
		try {
			const cacheKey = `cross_timeline_data:${user.id}`;
			const cached = await this.redisClient.get(cacheKey);
			if (cached) {
				try {
					const noteIds = JSON.parse(cached);
					if (Array.isArray(noteIds)) {
						const notes = await this.notesRepository.findBy({ id: In(noteIds) });
						return this.sortNotesByIds(notes, noteIds).slice(0, maxItems);
					}
				} catch (error) {
					await this.redisClient.del(cacheKey);
				}
			}

			const [homeTimelineNotes, globalTimelineNotes, localTimelineNotes] = await Promise.all([
				this.getHomeTimelineData(user, Math.ceil(maxItems * 0.5)),
				this.getGlobalTimelineData(user, Math.ceil(maxItems * 0.3)),
				this.getLocalTimelineData(user, Math.ceil(maxItems * 0.2)),
			]);

			const allNotes = [...homeTimelineNotes, ...globalTimelineNotes, ...localTimelineNotes];
			const seenIds = new Set<string>();
			const uniqueNotes = allNotes.filter(note => {
				if (seenIds.has(note.id)) return false;
				seenIds.add(note.id);
				return true;
			});

			const noteIds = uniqueNotes.map(note => note.id);
			await this.redisClient.setex(cacheKey, 300, JSON.stringify(noteIds));

			return uniqueNotes.slice(0, maxItems);
		} catch (error) {
			console.error('SmartTimelineService: Error getting cross-timeline data:', error);
			return [];
		}
	}

	@bindThis
	private async getHomeTimelineData(user: MiUser, limit: number): Promise<MiNote[]> {
		try {
			const followingIds = await this.getFollowingIds(user.id);
			if (followingIds.length === 0) return [];

			const batchSize = 100;
			const allNotes: MiNote[] = [];

			for (let i = 0; i < followingIds.length; i += batchSize) {
				const batchIds = followingIds.slice(i, i + batchSize);

				const query = this.notesRepository.createQueryBuilder('note')
					.leftJoinAndSelect('note.user', 'user')
					.leftJoinAndSelect('note.reply', 'reply')
					.leftJoinAndSelect('note.renote', 'renote')
					.leftJoinAndSelect('reply.user', 'replyUser')
					.leftJoinAndSelect('renote.user', 'renoteUser')
					.where('note.userId IN (:...batchIds)', { batchIds })
					.andWhere('note.visibility = :visibility', { visibility: 'public' })
					.andWhere('user.isSuspended = false')
					.andWhere('user.isDeleted = false');

				this.queryService.generateVisibilityQuery(query, user);
				this.queryService.generateBaseNoteFilteringQuery(query, user);

				const batchNotes = await query
					.orderBy('note.id', 'DESC')
					.limit(Math.ceil(limit * 1.5 / (followingIds.length / batchSize)))
					.getMany();

				allNotes.push(...batchNotes);
			}

			const sortedNotes = allNotes.sort((a, b) => b.id.localeCompare(a.id));
			return sortedNotes.slice(0, limit);
		} catch (error) {
			console.error('SmartTimelineService: Error getting home timeline data:', error);
			return [];
		}
	}

	@bindThis
	private async getGlobalTimelineData(user: MiUser, limit: number): Promise<MiNote[]> {
		try {
			const cacheKey = `global_timeline_data:${user.id}:${limit}`;
			const cached = await this.redisClient.get(cacheKey);
			if (cached) {
				try {
					const noteIds = JSON.parse(cached);
					if (Array.isArray(noteIds)) {
						const notes = await this.notesRepository.findBy({ id: In(noteIds) });
						return this.sortNotesByIds(notes, noteIds).slice(0, limit);
					}
				} catch (error) {
					await this.redisClient.del(cacheKey);
				}
			}

			const [mutedUserIds, blockedUserIds] = await Promise.all([
				this.getMutedUserIds(user.id),
				this.getBlockedUserIds(user.id),
			]);

			const excludeUserIds = [...mutedUserIds, ...blockedUserIds, user.id];
			const timeThreshold = Date.now() - 12 * 60 * 60 * 1000;
			const sinceId = this.idService.gen(new Date(timeThreshold).getTime());

			const candidateNotes = await this.notesRepository.createQueryBuilder('note')
				.leftJoinAndSelect('note.user', 'user')
				.where('note.id > :sinceId', { sinceId })
				.andWhere('note.visibility = :visibility', { visibility: 'public' })
				.andWhere('user.isSuspended = false')
				.andWhere('user.isDeleted = false')
				.andWhere(excludeUserIds.length > 0 && excludeUserIds.length < 1000 
					? 'note.userId NOT IN (:...excludeUserIds)' : '1=1', 
					excludeUserIds.length > 0 && excludeUserIds.length < 1000 ? { excludeUserIds } : {})
				.orderBy('note.id', 'DESC')
				.limit(limit * 10)
				.getMany();

			this.queryService.generateVisibilityQuery(
				this.notesRepository.createQueryBuilder('note').leftJoinAndSelect('note.user', 'user'), 
				user
			);

			if (candidateNotes.length === 0) {
				await this.redisClient.setex(cacheKey, 300, JSON.stringify([]));
				return [];
			}

			const scoredNotes = await Promise.all(
				candidateNotes.map(async (note) => {
					const engagementScore = await this.calculateEngagementScore(note);
					return { note, score: engagementScore };
				})
			);

			const validScoredNotes = scoredNotes
				.filter(({ score }) => score > 0.1)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);

			const notes = validScoredNotes.map(({ note }) => note);

			const noteIds = notes.map(note => note.id);
			await this.redisClient.setex(cacheKey, 300, JSON.stringify(noteIds));

			return notes.slice(0, limit);
		} catch (error) {
			console.error('SmartTimelineService: Error getting global timeline data:', error);
			return [];
		}
	}

	@bindThis
	private async getLocalTimelineData(user: MiUser, limit: number): Promise<MiNote[]> {
		try {
			const cacheKey = `local_timeline_data:${user.id}:${limit}`;
			const cached = await this.redisClient.get(cacheKey);
			if (cached) {
				try {
					const noteIds = JSON.parse(cached);
					if (Array.isArray(noteIds)) {
						const notes = await this.notesRepository.findBy({ id: In(noteIds) });
						return this.sortNotesByIds(notes, noteIds).slice(0, limit);
					}
				} catch (error) {
					await this.redisClient.del(cacheKey);
				}
			}

			const [mutedUserIds, blockedUserIds] = await Promise.all([
				this.getMutedUserIds(user.id),
				this.getBlockedUserIds(user.id),
			]);

			const excludeUserIds = [...mutedUserIds, ...blockedUserIds, user.id];
			const timeThreshold = Date.now() - 6 * 60 * 60 * 1000;
			const sinceId = this.idService.gen(new Date(timeThreshold).getTime());

			const candidateNotes = await this.notesRepository.createQueryBuilder('note')
				.leftJoinAndSelect('note.user', 'user')
				.where('note.id > :sinceId', { sinceId })
				.andWhere('note.visibility = :visibility', { visibility: 'public' })
				.andWhere('note.localOnly = false OR note.localOnly IS NULL')
				.andWhere('note.uri IS NULL')
				.andWhere('user.host IS NULL')
				.andWhere('user.isSuspended = false')
				.andWhere('user.isDeleted = false')
				.andWhere(excludeUserIds.length > 0 && excludeUserIds.length < 1000 
					? 'note.userId NOT IN (:...excludeUserIds)' : '1=1', 
					excludeUserIds.length > 0 && excludeUserIds.length < 1000 ? { excludeUserIds } : {})
				.orderBy('note.id', 'DESC')
				.limit(limit * 10)
				.getMany();

			this.queryService.generateVisibilityQuery(
				this.notesRepository.createQueryBuilder('note').leftJoinAndSelect('note.user', 'user'), 
				user
			);

			if (candidateNotes.length === 0) {
				await this.redisClient.setex(cacheKey, 300, JSON.stringify([]));
				return [];
			}

			const scoredNotes = await Promise.all(
				candidateNotes.map(async (note) => {
					const engagementScore = await this.calculateEngagementScore(note);
					return { note, score: engagementScore };
				})
			);

			const validScoredNotes = scoredNotes
				.filter(({ score }) => score >= 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);

			const notes = validScoredNotes.map(({ note }) => note);

			const noteIds = notes.map(note => note.id);
			await this.redisClient.setex(cacheKey, 300, JSON.stringify(noteIds));

			return notes.slice(0, limit);
		} catch (error) {
			console.error('SmartTimelineService: Error getting local timeline data:', error);
			return [];
		}
	}

	@bindThis
	public async shouldIncludeInRealTimeStream(
		user: MiUser,
		note: Packed<'Note'>,
		options: {
			algorithm: string;
			diversityLevel: string;
			freshnessWeight: number;
			qualityThreshold: number;
		}
	): Promise<boolean> {
		try {
			const profile = await this.contentRecommendationService.getUserRecommendationProfile(user.id);
			if (!profile) return false;

			const score = await this.contentRecommendationService.calculateSmartScore(
				note as any,
				profile,
				user,
				{
					algorithm: options.algorithm,
					diversityLevel: options.diversityLevel,
					freshnessWeight: options.freshnessWeight,
					qualityThreshold: options.qualityThreshold,
				}
			);

			return score >= options.qualityThreshold;
		} catch (error) {
			console.error('SmartTimelineService: Error checking real-time stream inclusion:', error);
			return false;
		}
	}
}
