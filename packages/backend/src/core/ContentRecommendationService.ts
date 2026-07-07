/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type {
	NotesRepository,
	FollowingsRepository,
	MutingsRepository,
	BlockingsRepository,
	NoteReactionsRepository,
	UserInteractionHistoryRepository,
	UserRecommendationProfileRepository,
	ContentRecommendationLogRepository
} from '@/models/_.js';
import type { MiUser, MiNote } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { RecommendationAlgorithms } from '@/core/RecommendationAlgorithms.js';
import { In, MoreThan } from 'typeorm';

export interface RecommendationOptions {
	limit?: number;
	offset?: number;
	context?: 'timeline' | 'explore' | 'related' | 'trending';
	includeFollowing?: boolean;
	diversityFactor?: number;
	recencyWeight?: number;
	qualityThreshold?: number;
	excludeNoteIds?: string[];
	excludeUserIds?: string[];
}

export interface RecommendationResult {
	notes: MiNote[];
	scores: Record<string, number>;
	algorithm: string;
	factors: Record<string, number>;
	totalCount: number;
	hasMore: boolean;
}

export interface UserProfile {
	interests: Record<string, number>;
	contentTypes: Record<string, number>;
	languages: Record<string, number>;
	topics: Record<string, number>;
	socialFactors: {
		followingInfluence: number;
		mutualConnectionWeight: number;
		popularityBias: number;
		diversityPreference: number;
	};
	temporalPatterns: {
		recencyWeight: number;
		timeOfDayActivity: Record<string, number>;
		dayOfWeekActivity: Record<string, number>;
	};
	qualityPreference: number;
	diversityPreference: number;
	explorationFactor: number;
}

@Injectable()
export class ContentRecommendationService {
	private readonly CACHE_TTL = 60 * 15;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

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

		@Inject(DI.contentRecommendationLogRepository)
		private contentRecommendationLogRepository: ContentRecommendationLogRepository,

		private idService: IdService,
		private queryService: QueryService,
		private recommendationAlgorithms: RecommendationAlgorithms,
	) {}

	@bindThis
	private buildCandidatesCacheKey(userId: string, context: string, limit: number, offset: number): string {
		return `candidates:${userId}:${context}:${limit}:${offset}`;
	}

	@bindThis
	public async getRecommendations(
		user: MiUser,
		options: RecommendationOptions = {}
	): Promise<RecommendationResult> {
		try {
			const {
				limit = Math.min(100, Math.max(1, options.limit ?? 20)),
				offset = Math.max(0, options.offset ?? 0),
				context = 'timeline',
				diversityFactor,
				recencyWeight,
				qualityThreshold
			} = options;

			const userProfile = await this.getUserProfile(user.id);

			const finalDiversityFactor = diversityFactor ?? userProfile.diversityPreference;
		const finalRecencyWeight = recencyWeight ?? userProfile.temporalPatterns.recencyWeight ?? 0.7;
		const finalQualityThreshold = qualityThreshold ?? userProfile.qualityPreference;

			const candidates = await this.getCandidateNotes(user, {
			...options,
			diversityFactor: finalDiversityFactor,
			recencyWeight: finalRecencyWeight,
			qualityThreshold: finalQualityThreshold,
		});

			const scoredNotes = await this.scoreNotes(user, candidates, userProfile, context);

			const filteredNotes = await this.applyFilters(scoredNotes, userProfile, {
			diversityFactor: finalDiversityFactor,
			qualityThreshold: finalQualityThreshold,
		});

			const sortedNotes = filteredNotes
			.sort((a, b) => b.score - a.score)
			.slice(offset, offset + limit);

		const notes = sortedNotes.map(item => item.note);
		const scores = Object.fromEntries(sortedNotes.map(item => [item.note.id, item.score]));

			await this.logRecommendations(user.id, sortedNotes, context);

			return {
				notes,
				scores,
				algorithm: 'hybrid_collaborative_content',
				factors: this.calculateFactorWeights(userProfile),
				totalCount: filteredNotes.length,
				hasMore: filteredNotes.length > offset + limit,
			};
		} catch (error) {
			console.error('Error in getRecommendations:', error);
			return {
				notes: [],
				scores: {},
				algorithm: 'hybrid_collaborative_content',
				factors: {},
				totalCount: 0,
				hasMore: false,
			};
		}
	}

	@bindThis
	private async getUserProfile(userId: string): Promise<UserProfile> {
		const cacheKey = `user:profile:${userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}

		let dbProfile = await this.userRecommendationProfileRepository.findOneBy({ userId });

		if (!dbProfile || this.shouldUpdateProfile(dbProfile)) {
			dbProfile = await this.updateUserProfile(userId);
		}

		const profile: UserProfile = {
			interests: dbProfile?.interestCategories || {},
			contentTypes: dbProfile?.contentTypePreferences || { text: 0.5, media: 0.5, poll: 0.3 },
			languages: dbProfile?.languagePreferences || { en: 0.8 },
			topics: dbProfile?.topicPreferences || {},
			socialFactors: {
				followingInfluence: dbProfile?.socialPreferences?.followingInfluence ?? 0.7,
				mutualConnectionWeight: dbProfile?.socialPreferences?.mutualConnectionWeight ?? 0.5,
				popularityBias: dbProfile?.socialPreferences?.popularityBias ?? 0.3,
				diversityPreference: dbProfile?.socialPreferences?.diversityPreference ?? 0.5,
			},
			temporalPatterns: {
				recencyWeight: dbProfile?.recencyWeight ?? 0.7,
				timeOfDayActivity: dbProfile?.interactionPatterns?.timeOfDayActivity || {},
				dayOfWeekActivity: dbProfile?.interactionPatterns?.dayOfWeekActivity || {},
			},
			qualityPreference: dbProfile?.qualityThreshold ?? 0.5,
			diversityPreference: dbProfile?.socialPreferences?.diversityPreference ?? 0.5,
			explorationFactor: dbProfile?.explorationFactor ?? 0.3,
		};

		await this.redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(profile));
		return profile;
	}

	@bindThis
	private shouldUpdateProfile(profile: any): boolean {
		if (!profile || !profile.updatedAt) return true;
		const lastUpdate = new Date(profile.updatedAt);
		const now = new Date();
		const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
		return hoursSinceUpdate > 24;
	}

	@bindThis
	private async getCandidateNotes(user: MiUser, options: RecommendationOptions): Promise<MiNote[]> {
		const cacheKey = this.buildCandidatesCacheKey(user.id, options.context || 'timeline', options.limit || 20, options.offset || 0);
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const noteIds = JSON.parse(cached);
			return await this.getNotesWithMinimalJoins(noteIds);
		}

		const [followingIds, mutedUserIds, blockedUserIds] = await Promise.all([
			this.getFollowingIds(user.id),
			this.getMutedUserIds(user.id),
			this.getBlockedUserIds(user.id),
		]);

		const timeThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const sinceId = this.idService.gen(new Date(timeThreshold).getTime());

		const query = this.notesRepository.createQueryBuilder('note')
			.leftJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser')
			.where('note.id > :sinceId', { sinceId })
			.andWhere('note.visibility = :visibility', { visibility: 'public' })
			.andWhere('user.isSuspended = false')
			.andWhere('user.isDeleted = false');

		if (mutedUserIds.length > 0 && mutedUserIds.length < 1000) {
			query.andWhere('note.userId NOT IN (:...mutedUserIds)', { mutedUserIds });
		}
		if (blockedUserIds.length > 0 && blockedUserIds.length < 1000) {
			query.andWhere('note.userId NOT IN (:...blockedUserIds)', { blockedUserIds });
		}

		if (options.excludeNoteIds && options.excludeNoteIds.length > 0) {
			query.andWhere('note.id NOT IN (:...excludeNoteIds)', { excludeNoteIds: options.excludeNoteIds });
		}
		if (options.excludeUserIds && options.excludeUserIds.length > 0) {
			query.andWhere('note.userId NOT IN (:...excludeUserIds)', { excludeUserIds: options.excludeUserIds });
		}

		if (options.includeFollowing && followingIds.length > 0 && followingIds.length < 1000) {
			query.andWhere('(note.userId IN (:...followingIds) OR note.visibility = :publicVisibility)', {
				followingIds,
				publicVisibility: 'public'
			});
		}

		this.queryService.generateVisibilityQuery(query, user);
		this.queryService.generateBaseNoteFilteringQuery(query, user);

		const allCandidates = await query
			.orderBy('note.id', 'DESC')
			.limit(1000)
			.getMany();

		const candidates = allCandidates.filter(note => {
			try {
				const noteTime = this.idService.parse(note.id).date.getTime();
				return noteTime > timeThreshold;
			} catch {
				return false;
			}
		}).slice(0, 1000);

		const candidateIds = candidates.map(note => note.id);
		await this.redisClient.setex(cacheKey, 300, JSON.stringify(candidateIds));

		return candidates;
	}

	@bindThis
	private async scoreNotes(
		user: MiUser,
		notes: MiNote[],
		profile: UserProfile,
		context: string
	): Promise<Array<{ note: MiNote; score: number; factors: Record<string, number> }>> {
		return await Promise.all(notes.map(async (note) => {
			const factors = await this.calculateNoteFactors(user, note, profile, context);
			const score = this.calculateFinalScore(factors, profile, note);
			return { note, score, factors };
		}));
	}

	@bindThis
	private async calculateNoteFactors(
		user: MiUser,
		note: MiNote,
		profile: UserProfile,
		context: string
	): Promise<Record<string, number>> {
		const factors: Record<string, number> = {};

		factors.contentRelevance = await this.calculateEnhancedContentRelevance(note, profile, user);
		factors.topicMatch = await this.calculateSemanticTopicMatch(note, profile);
		factors.languageMatch = await this.calculateLanguageMatch(note, profile);
		factors.contentTypeMatch = this.calculateContentTypeMatch(note, profile);

		factors.authorRelevance = await this.calculateAuthorRelevance(user, note, profile);
		factors.federatedSocialProof = await this.calculateFederatedSocialProof(note, user);
		factors.crossInstanceNovelty = await this.calculateCrossInstanceNovelty(note, user);
		factors.communityResonance = await this.calculateCommunityResonance(note, user, profile);

		factors.recency = this.calculateAdaptiveRecency(note, profile);
		factors.trendingScore = await this.calculateTrendingScore(note);
		factors.viralityPotential = await this.calculateViralityPotential(note, user);

		factors.engagementQuality = await this.calculateEngagementQuality(note);
		factors.authorReputation = await this.calculateAuthorReputation(note.user);
		factors.contentQuality = await this.calculateContentQuality(note);

		factors.collaborativeFiltering = await this.calculateCollaborativeFiltering(user, note);
		factors.diversityBonus = await this.calculateSmartDiversityBonus(note, profile, user);
		factors.serendipityScore = await this.calculateSerendipityScore(note, user, profile);
		factors.antiEchoChambering = await this.calculateAntiEchoChambering(note, user, profile);

		factors.contextRelevance = this.calculateContextRelevance(note, context, profile);

		return factors;
	}

	@bindThis
	private calculateFinalScore(factors: Record<string, number>, profile: UserProfile, note?: MiNote): number {
		const baseWeights = {
			contentRelevance: 0.15,
			topicMatch: 0.12,
			languageMatch: 0.03,
			contentTypeMatch: 0.05,
			contentQuality: 0.05,

			authorRelevance: 0.08,
			federatedSocialProof: 0.07,
			crossInstanceNovelty: 0.04,
			communityResonance: 0.06,
			authorReputation: 0.05,

			recency: 0.08,
			trendingScore: 0.04,
			viralityPotential: 0.03,

			collaborativeFiltering: 0.04,
			diversityBonus: 0.03,
			serendipityScore: 0.02,
			antiEchoChambering: 0.01,

			engagementQuality: 0.03,
			contextRelevance: 0.02,
		};

		const userRecencyWeight = profile.temporalPatterns.recencyWeight ?? 0.7;
		const userDiversityPreference = profile.diversityPreference ?? 0.5;
		const userExplorationFactor = profile.explorationFactor ?? 0.3;

		const weights = {
			...baseWeights,
			recency: baseWeights.recency * userRecencyWeight,
			diversityBonus: baseWeights.diversityBonus * userDiversityPreference,
			serendipityScore: baseWeights.serendipityScore * userExplorationFactor,
			antiEchoChambering: baseWeights.antiEchoChambering * userDiversityPreference,
			crossInstanceNovelty: baseWeights.crossInstanceNovelty * userExplorationFactor,
		};

		let score = 0;
		for (const [factor, value] of Object.entries(factors)) {
			const weight = weights[factor as keyof typeof weights] ?? 0;
			score += (value || 0) * weight;
		}

		const explorationBonus = Math.random() * userExplorationFactor * 0.05;

		const qualityGate = factors.contentQuality ?? 0.5;
		if (qualityGate < profile.qualityPreference) {
			score *= 0.7;
		}

		if (note && (note as any).isDeleted) {
			score *= 0.3;
		}

		return Math.min(1, Math.max(0, score + explorationBonus));
	}

	@bindThis
	private async calculateLanguageMatch(note: MiNote, profile: UserProfile): Promise<number> {
		const detectedLang = await this.recommendationAlgorithms.detectLanguage(note.text);
		return profile.languages[detectedLang] ?? 0.5;
	}

	@bindThis
	private calculateContentTypeMatch(note: MiNote, profile: UserProfile): number {
		let typeScore = 0;
		let typeCount = 0;

		if (note.text && note.text.length > 0) {
			typeScore += profile.contentTypes.text ?? 0.7;
			typeCount++;
		}

		if (note.fileIds && note.fileIds.length > 0) {
			typeScore += profile.contentTypes.media ?? 0.6;
			typeCount++;
		}

		if (note.hasPoll) {
			typeScore += profile.contentTypes.poll ?? 0.5;
			typeCount++;
		}

		if (note.replyId) {
			typeScore += profile.contentTypes.conversation ?? 0.6;
			typeCount++;
		}

		return typeCount > 0 ? typeScore / typeCount : 0.5;
	}

	@bindThis
	private async calculateAuthorRelevance(user: MiUser, note: MiNote, profile: UserProfile): Promise<number> {
		if (!note.user) return 0.5;

		const cacheKey = `author:relevance:${user.id}:${note.userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		let relevanceScore = 0.5;

		const interactions = await this.userInteractionHistoryRepository.count({
			where: {
				userId: user.id,
				targetId: note.userId,
				targetType: 'user',
				createdAt: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
			},
		});

		if (interactions > 0) {
			relevanceScore += Math.min(0.3, interactions * 0.05);
		}

		const popularityScore = Math.log(note.user.followersCount + 1) / Math.log(10000);
		relevanceScore += popularityScore * (profile.socialFactors.popularityBias ?? 0.2);

		await this.redisClient.setex(cacheKey, 3600, relevanceScore.toString());
		return Math.min(1, relevanceScore);
	}

	@bindThis
	private async calculateSocialProof(note: MiNote | Packed<'Note'>, _user: MiUser): Promise<number> {
		const cacheKey = `social:proof:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const [reactionCount, renoteCount, replyCount] = await Promise.all([
			this.noteReactionsRepository.count({ where: { noteId: note.id } }),
			this.notesRepository.count({ where: { renoteId: note.id } }),
			this.notesRepository.count({ where: { replyId: note.id } }),
		]);

		const totalEngagement = reactionCount + renoteCount + replyCount;
		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		const engagementRate = totalEngagement / Math.max(1, ageHours);

		const socialScore = Math.min(1, Math.log(engagementRate + 1) / Math.log(10));

		await this.redisClient.setex(cacheKey, 600, socialScore.toString());
		return socialScore;
	}

	@bindThis
	private async calculateNetworkEffect(user: MiUser, note: MiNote): Promise<number> {
		const followingIds = await this.getFollowingIds(user.id);
		if (followingIds.length === 0) return 0.3;

		const mutualConnections = await this.followingsRepository.count({
			where: {
				followerId: In(followingIds),
				followeeId: note.userId,
			},
		});

		return Math.min(1, mutualConnections / Math.max(1, followingIds.length * 0.1));
	}

	@bindThis
	private calculateRecency(note: MiNote): number {
		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		return Math.exp(-ageHours / 24);
	}

	@bindThis
	private async calculateTrendingScore(note: MiNote): Promise<number> {
		const cacheKey = `trending:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
		const recentEngagement = await this.noteReactionsRepository.count({
			where: {
				noteId: note.id,
				id: MoreThan(this.idService.gen(sixHoursAgo.getTime())),
			},
		});

		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = Math.max(1, noteAge / (1000 * 60 * 60));
		const engagementVelocity = recentEngagement / ageHours;

		const trendingScore = Math.min(1, Math.log(engagementVelocity + 1) / Math.log(5));

		await this.redisClient.setex(cacheKey, 1800, trendingScore.toString());
		return trendingScore;
	}

	@bindThis
	private async calculateEngagementQuality(note: MiNote): Promise<number> {
		const [reactions, replies, renotes] = await Promise.all([
			this.noteReactionsRepository.count({ where: { noteId: note.id } }),
			this.notesRepository.count({ where: { replyId: note.id } }),
			this.notesRepository.count({ where: { renoteId: note.id } }),
		]);

		const qualityScore = (reactions + replies * 2.0 + renotes * 1.5) / 10;
		return Math.min(1, qualityScore);
	}

	@bindThis
	private async calculateAuthorQuality(author: MiUser | null): Promise<number> {
		if (!author) return 0.5;

		const cacheKey = `author:quality:${author.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const followerRatio = author.followersCount / Math.max(1, author.followingCount);
		const ratioScore = Math.min(1, Math.log(followerRatio + 1) / Math.log(10));

		const accountAge = Date.now() - this.idService.parse(author.id).date.getTime();
		const ageDays = accountAge / (1000 * 60 * 60 * 24);
		const ageScore = Math.min(1, ageDays / 365);

		const qualityScore = (ratioScore * 0.6 + ageScore * 0.4);

		await this.redisClient.setex(cacheKey, 7200, qualityScore.toString());
		return qualityScore;
	}

	@bindThis
	private async calculateSimilarityToLiked(user: MiUser, note: MiNote): Promise<number> {
		const recentLikes = await this.noteReactionsRepository.find({
			where: {
				userId: user.id,
				id: MoreThan(this.idService.gen(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).getTime())),
			},
			relations: { note: true },
			take: 50,
		});

		if (recentLikes.length === 0) return 0.5;

		let similarityScore = 0;
		let comparisons = 0;

		for (const like of recentLikes) {
			if (!like.note) continue;

			const commonTags = this.getCommonTags(note.tags || [], like.note.tags || []);
			const tagSimilarity = commonTags.length / Math.max(1, Math.max(note.tags?.length || 0, like.note.tags?.length || 0));

			const textSimilarity = this.calculateTextSimilarity(note.text, like.note.text);

			similarityScore += (tagSimilarity * 0.7 + textSimilarity * 0.3);
			comparisons++;
		}

		return comparisons > 0 ? Math.min(1, similarityScore / comparisons) : 0.5;
	}

	@bindThis
	private calculateDiversityBonus(note: MiNote, profile: UserProfile): number {
		const diversityFactor = profile.diversityPreference;

		let diversityScore = 0;

		if (note.fileIds && note.fileIds.length > 0) diversityScore += 0.3;
		if (note.hasPoll) diversityScore += 0.2;
		if (note.tags && note.tags.length > 0) diversityScore += 0.2;
		if (note.replyId) diversityScore += 0.1;
		if (note.text && note.text.length > 100) diversityScore += 0.2;

		return diversityScore * diversityFactor;
	}

	@bindThis
	private calculateContextRelevance(note: MiNote, context: string, _profile: UserProfile): number {
		switch (context) {
			case 'timeline':
				return note.replyId ? 0.8 : 1.0;
			case 'explore':
				return note.tags && note.tags.length > 0 ? 1.0 : 0.7;
			case 'related':
				return 0.9;
			case 'trending':
				return 1.0;
			default:
				return 0.8;
		}
	}

	@bindThis
	private calculateFactorWeights(profile: UserProfile): Record<string, number> {
		return {
			contentRelevance: 0.25,
			socialFactors: profile.socialFactors.followingInfluence ?? 0.15,
			recency: profile.temporalPatterns.recencyWeight ?? 0.15,
			quality: profile.qualityPreference,
			diversity: profile.diversityPreference,
			exploration: profile.explorationFactor,
		};
	}

	@bindThis
	private async applyFilters(
		scoredNotes: Array<{ note: MiNote; score: number; factors: Record<string, number> }>,
		_profile: UserProfile,
		options: { diversityFactor: number; qualityThreshold: number }
	): Promise<Array<{ note: MiNote; score: number; factors: Record<string, number> }>> {
		let filtered = scoredNotes.filter(item => item.score >= options.qualityThreshold);

		if (options.diversityFactor > 0.5) {
			filtered = this.applyDiversityFilter(filtered, options.diversityFactor);
		}

		return filtered;
	}

	@bindThis
	private applyDiversityFilter(
		scoredNotes: Array<{ note: MiNote; score: number; factors: Record<string, number> }>,
		diversityFactor: number
	): Array<{ note: MiNote; score: number; factors: Record<string, number> }> {
		const result: Array<{ note: MiNote; score: number; factors: Record<string, number> }> = [];
		const authorCounts = new Map<string, number>();
		const usedTags = new Set<string>();
		const maxAuthorRepeat = diversityFactor > 0.8 ? 1 : 2;

		for (const item of scoredNotes) {
			const authorCount = authorCounts.get(item.note.userId) ?? 0;

			if (authorCount >= maxAuthorRepeat) {
				continue;
			}

			if (diversityFactor > 0.7 && item.note.tags) {
				const hasUsedTag = item.note.tags.some(tag => usedTags.has(tag));
				if (hasUsedTag && result.length > 5) {
					continue;
				}
			}

			result.push(item);
			authorCounts.set(item.note.userId, authorCount + 1);

			if (item.note.tags) {
				item.note.tags.forEach(tag => usedTags.add(tag));
			}

			if (result.length >= 100) {
				break;
			}
		}

		return result;
	}

	@bindThis
	private async logRecommendations(
		userId: string,
		recommendations: Array<{ note: MiNote; score: number; factors: Record<string, number> }>,
		context: string
	): Promise<void> {
		const logs = recommendations.map((item, index) => ({
			id: this.idService.gen(),
			userId,
			noteId: item.note.id,
			algorithm: 'hybrid_collaborative_content',
			score: item.score,
			position: index,
			context,
			factors: item.factors,
			viewed: false,
			engaged: false,
			engagementType: null,
			viewDuration: null,
			createdAt: new Date(),
			viewedAt: null,
			engagedAt: null,
		}));

		if (logs.length > 0) {
			await this.contentRecommendationLogRepository.save(logs);
		}
	}

	@bindThis
	private async updateUserProfile(userId: string): Promise<any> {
		let profile = await this.userRecommendationProfileRepository.findOneBy({ userId });
		if (profile) {
			return profile;
		}

		const defaultProfile = {
			id: this.idService.gen(),
			userId,
			interestCategories: {},
			contentTypePreferences: { text: 0.5, media: 0.5, poll: 0.3 },
			languagePreferences: { en: 0.8 },
			topicPreferences: {},
			socialPreferences: {
				followingInfluence: 0.7,
				mutualConnectionWeight: 0.5,
				popularityBias: 0.3,
				diversityPreference: 0.5,
			},
			interactionPatterns: {
				timeOfDayActivity: {},
				dayOfWeekActivity: {},
			},
			recencyWeight: 0.7,
			qualityThreshold: 0.5,
			explorationFactor: 0.3,
			updatedAt: new Date(),
		};

		try {
			await this.userRecommendationProfileRepository.save(defaultProfile);
			return defaultProfile;
		} catch (error: any) {
			if (error.code === '23505' || error.message?.includes('duplicate key')) {
				profile = await this.userRecommendationProfileRepository.findOneBy({ userId });
				if (profile) {
					return profile;
				}
			}
			throw error;
		}
	}

	@bindThis
	private getCommonTags(tags1: string[], tags2: string[]): string[] {
		return tags1.filter(tag => tags2.includes(tag));
	}

	@bindThis
	private calculateTextSimilarity(text1: string | null, text2: string | null): number {
		if (!text1 || !text2) return 0;

		const words1 = text1.toLowerCase().split(/\s+/);
		const words2 = text2.toLowerCase().split(/\s+/);

		const commonWords = words1.filter(word => words2.includes(word));
		const totalWords = Math.max(words1.length, words2.length);

		return totalWords > 0 ? commonWords.length / totalWords : 0;
	}

	@bindThis
	public async recordInteraction(
		userId: string,
		targetId: string,
		targetType: 'note' | 'user' | 'hashtag' | 'category',
		interactionType: 'view' | 'like' | 'reply' | 'renote' | 'follow' | 'bookmark' | 'share' | 'click',
		context: any = {}
	): Promise<void> {
		const interaction = {
			id: this.idService.gen(),
			userId,
			targetId,
			targetType,
			interactionType,
			weight: this.getInteractionWeight(interactionType),
			duration: context.duration ?? null,
			context,
			createdAt: new Date(),
			implicit: ['view', 'click'].includes(interactionType),
			relevanceScore: null,
		};

		await this.userInteractionHistoryRepository.save(interaction);

		if (interactionType !== 'view') {
			await this.updateRecommendationLog(userId, targetId, interactionType);
		}
	}

	@bindThis
	private getInteractionWeight(interactionType: string): number {
		const weights = {
			view: 0.1,
			click: 0.2,
			like: 1.0,
			reply: 2.0,
			renote: 1.5,
			bookmark: 2.5,
			follow: 3.0,
			share: 2.0,
		};

		return weights[interactionType as keyof typeof weights] ?? 1.0;
	}

	@bindThis
	private async updateRecommendationLog(
		userId: string,
		noteId: string,
		interactionType: string
	): Promise<void> {
		const log = await this.contentRecommendationLogRepository.findOne({
			where: {
				userId,
				noteId,
				engaged: false,
			},
			order: { createdAt: 'DESC' },
		});

		if (log) {
			log.engaged = true;
			log.engagementType = interactionType;
			log.engagedAt = new Date();
			await this.contentRecommendationLogRepository.save(log);
		}
	}

	@bindThis
	private async getFollowingIds(userId: string): Promise<string[]> {
		const cacheKey = `following:${userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}

		const followings = await this.followingsRepository.find({
			where: { followerId: userId },
			select: { followeeId: true },
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
			return JSON.parse(cached);
		}

		const mutings = await this.mutingsRepository.find({
			where: { muterId: userId },
			select: { muteeId: true },
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
			return JSON.parse(cached);
		}

		const blockings = await this.blockingsRepository.find({
			where: { blockerId: userId },
			select: { blockeeId: true },
		});

		const blockedIds = blockings.map(b => b.blockeeId);
		await this.redisClient.setex(cacheKey, 3600, JSON.stringify(blockedIds));
		return blockedIds;
	}

	@bindThis
	private async calculateEnhancedContentRelevance(note: MiNote, profile: UserProfile, user: MiUser): Promise<number> {
		if (!note.text) return 0.3;

		const cacheKey = `enhanced:relevance:${user.id}:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const text = note.text.toLowerCase();
		let relevanceScore = 0;
		let totalWeight = 0;

		for (const [interest, weight] of Object.entries(profile.interests)) {
			const keywordMatches = this.findSemanticMatches(text, interest.toLowerCase());
			if (keywordMatches > 0) {
				relevanceScore += weight * Math.min(1.5, keywordMatches);
				totalWeight += weight;
			}
		}

		const textLength = note.text.length;
		const timeOfDayActivity = profile.temporalPatterns?.timeOfDayActivity || {};
		const activityValues = Object.values(timeOfDayActivity);
		const preferredLength = activityValues.length > 0 ?
			activityValues.reduce((a, b) => a + b, 0) / activityValues.length * 300 :
			200;
		const lengthScore = 1 - Math.abs(textLength - preferredLength) / Math.max(textLength, preferredLength);
		relevanceScore += lengthScore * 0.15;
		totalWeight += 0.15;

		const sentimentScore = this.analyzeSentiment(note.text);
		const preferredSentiment = profile.qualityPreference;
		const sentimentMatch = 1 - Math.abs(sentimentScore - preferredSentiment);
		relevanceScore += sentimentMatch * 0.1;
		totalWeight += 0.1;

		const finalScore = totalWeight > 0 ? Math.min(1, relevanceScore / totalWeight) : 0.5;
		const safeScore = Number.isNaN(finalScore) ? 0.5 : finalScore;
		await this.redisClient.setex(cacheKey, 1800, safeScore.toString());
		return safeScore;
	}

	@bindThis
	private async calculateSemanticTopicMatch(note: MiNote, profile: UserProfile): Promise<number> {
		if (!note.tags || note.tags.length === 0) {
			const extractedTopics = this.extractTopicsFromText(note.text);
			if (extractedTopics.length === 0) return 0.3;

			let topicScore = 0;
			for (const topic of extractedTopics) {
				topicScore += profile.topics[topic] ?? 0.1;
			}
			return Math.min(1, topicScore / extractedTopics.length);
		}

		let topicScore = 0;
		let matchCount = 0;
		let semanticMatches = 0;

		for (const tag of note.tags) {
			const directWeight = profile.topics[tag] ?? 0;
			if (directWeight > 0) {
				topicScore += directWeight;
				matchCount++;
			} else {
				const semanticWeight = this.calculateSemanticTopicSimilarity(tag, profile.topics);
				if (semanticWeight > 0.3) {
					topicScore += semanticWeight * 0.7;
					semanticMatches++;
				}
			}
		}

		const diversityBonus = (matchCount + semanticMatches) > 1 ? Math.log(matchCount + semanticMatches) * 0.1 : 0;
		const totalMatches = Math.max(1, matchCount + semanticMatches);

		return Math.min(1, (topicScore / Math.max(1, note.tags.length)) + diversityBonus);
	}

	@bindThis
	private async calculateFederatedSocialProof(note: MiNote, user: MiUser): Promise<number> {
		const cacheKey = `federated:social:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const [localReactions, localRenotes, localReplies] = await Promise.all([
			this.noteReactionsRepository.count({
				where: { noteId: note.id }
			}),
			this.notesRepository.count({
				where: { renoteId: note.id }
			}),
			this.notesRepository.count({
				where: { replyId: note.id }
			})
		]);

		const localEngagement = localReactions + localRenotes + localReplies;
		const estimatedFederatedEngagement = note.userHost ? localEngagement * 2.5 : localEngagement;

		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		const federatedDecay = note.userHost ? Math.exp(-ageHours / 12) : Math.exp(-ageHours / 24);

		const engagementRate = estimatedFederatedEngagement / Math.max(1, ageHours);
		const socialScore = Math.min(1, Math.log(engagementRate * federatedDecay + 1) / Math.log(15));

		const crossInstanceBonus = note.userHost && localEngagement > 0 ? 0.2 : 0;

		const finalScore = Math.min(1, socialScore + crossInstanceBonus);
		await this.redisClient.setex(cacheKey, 900, finalScore.toString());
		return finalScore;
	}

	@bindThis
	private async calculateCrossInstanceNovelty(note: MiNote, user: MiUser): Promise<number> {
		if (!note.userHost) {
			return 0.3;
		}

		const cacheKey = `novelty:${user.id}:${note.userHost}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const recentInteractions = await this.userInteractionHistoryRepository.count({
			where: {
				userId: user.id,
				createdAt: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
			}
		});

		const interactionDiversity = Math.max(0.1, 1 - (recentInteractions / 100));

		const instanceNovelty = 0.7 + (Math.random() * 0.3);

		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		const freshnessNovelty = Math.exp(-ageHours / 8);

		const noveltyScore = interactionDiversity * instanceNovelty * freshnessNovelty;
		await this.redisClient.setex(cacheKey, 3600, noveltyScore.toString());
		return Math.min(1, noveltyScore);
	}

	@bindThis
	private async calculateCommunityResonance(note: MiNote, user: MiUser, profile: UserProfile): Promise<number> {
		const cacheKey = `community:resonance:${user.id}:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const followingIds = await this.getFollowingIds(user.id);
		if (followingIds.length === 0) return 0.5;

		const networkEngagement = await this.noteReactionsRepository.count({
			where: {
				noteId: note.id,
				userId: In(followingIds)
			}
		});

		const networkRenotes = await this.notesRepository.count({
			where: {
				renoteId: note.id,
				userId: In(followingIds)
			}
		});

		const networkInteractions = networkEngagement + networkRenotes;
		const networkSize = followingIds.length;
		const engagementRatio = networkInteractions / Math.max(1, networkSize * 0.05);

		const communityAlignment = await this.calculateCommunityAlignment(note, profile);

		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);
		const trendinessDecay = Math.exp(-ageHours / 6);

		const resonanceScore = Math.min(1, (engagementRatio * 0.6 + communityAlignment * 0.4) * trendinessDecay);
		await this.redisClient.setex(cacheKey, 1200, resonanceScore.toString());
		return resonanceScore;
	}

	@bindThis
	private calculateAdaptiveRecency(note: MiNote, profile: UserProfile): number {
		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);

		const recencyWeight = profile.temporalPatterns.recencyWeight ?? 0.7;
		const adaptiveHalfLife = 24 * (1 - recencyWeight) + 8 * recencyWeight;

		const currentHour = new Date().getHours();
		const hourlyActivity = profile.temporalPatterns.timeOfDayActivity?.[currentHour.toString()] ?? 0.5;
		const timeBonus = hourlyActivity * 0.2;

		return Math.min(1, Math.exp(-ageHours / adaptiveHalfLife) + timeBonus);
	}

	@bindThis
	private async calculateViralityPotential(note: MiNote, user: MiUser): Promise<number> {
		const cacheKey = `virality:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const recentWindow = new Date(Date.now() - 2 * 60 * 60 * 1000);
		const recentEngagement = await this.noteReactionsRepository.count({
			where: {
				noteId: note.id,
				id: MoreThan(this.idService.gen(recentWindow.getTime()))
			}
		});

		const authorInfluence = note.user ? Math.log(note.user.followersCount + 1) / Math.log(1000) : 0.5;

		const contentLength = note.text?.length ?? 0;
		const hasMedia = note.fileIds && note.fileIds.length > 0;
		const isConversational = !!note.replyId;

		const viralityFactors = {
			optimalLength: contentLength > 50 && contentLength < 280 ? 1 : 0.7,
			mediaBoost: hasMedia ? 1.3 : 1,
			conversationPenalty: isConversational ? 0.8 : 1,
			topicRelevance: note.tags?.length ? Math.min(1.2, 1 + note.tags.length * 0.1) : 1
		};

		const baseVirality = recentEngagement * authorInfluence;
		const contentMultiplier = Object.values(viralityFactors).reduce((a, b) => a * b, 1);

		const viralityScore = Math.min(1, (baseVirality * contentMultiplier) / 10);
		await this.redisClient.setex(cacheKey, 600, viralityScore.toString());
		return viralityScore;
	}

	@bindThis
	private async calculateAuthorReputation(author: MiUser | null): Promise<number> {
		if (!author) return 0.5;

		const cacheKey = `author:reputation:${author.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const accountAge = Date.now() - this.idService.parse(author.id).date.getTime();
		const ageDays = accountAge / (1000 * 60 * 60 * 24);
		const ageScore = Math.min(1, ageDays / 365);

		const followerRatio = author.followersCount / Math.max(1, author.followingCount);
		const ratioScore = Math.min(1, Math.log(followerRatio + 1) / Math.log(10));

		const activityScore = Math.min(1, Math.log(author.notesCount + 1) / Math.log(1000));

		const standingScore = author.isBot ? 0.7 : 1.0;

		const reputationScore = (ageScore * 0.3 + ratioScore * 0.3 + activityScore * 0.2 + standingScore * 0.2);
		await this.redisClient.setex(cacheKey, 7200, reputationScore.toString());
		return reputationScore;
	}

	@bindThis
	private async calculateContentQuality(note: MiNote): Promise<number> {
		let qualityScore = 0.5;

		if (note.text) {
			const textLength = note.text.length;
			const wordCount = note.text.split(/\s+/).length;

			const lengthScore = textLength > 20 && textLength < 500 ? 1 : 0.7;

			const avgWordLength = textLength / Math.max(1, wordCount);
			const readabilityScore = avgWordLength > 2 && avgWordLength < 8 ? 1 : 0.8;

			const uniqueWords = new Set(note.text.toLowerCase().split(/\s+/)).size;
			const vocabularyRichness = uniqueWords / Math.max(1, wordCount);
			const densityScore = vocabularyRichness > 0.6 ? 1 : 0.8;

			qualityScore += (lengthScore * 0.3 + readabilityScore * 0.3 + densityScore * 0.2) * 0.4;
		}

		if (note.fileIds && note.fileIds.length > 0) {
			qualityScore += 0.2;
			if (note.text && note.text.length > 0) {
				qualityScore += 0.1;
			}
		}

		const hasHashtags = note.tags && note.tags.length > 0;
		const hasMentions = note.text?.includes('@') ?? false;
		const isConversationStarter = !note.replyId && (hasHashtags || hasMentions);

		if (isConversationStarter) qualityScore += 0.1;

		return Math.min(1, qualityScore);
	}

	@bindThis
	private async calculateCollaborativeFiltering(user: MiUser, note: MiNote): Promise<number> {
		const cacheKey = `collab:filter:${user.id}:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			const parsed = parseFloat(cached);
			return Number.isNaN(parsed) ? 0.5 : parsed;
		}

		const userInteractions = await this.userInteractionHistoryRepository.find({
			where: {
				userId: user.id,
				createdAt: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
				interactionType: In(['like', 'renote', 'reply'])
			},
			take: 50
		});

		if (userInteractions.length < 5) return 0.5;

		const interactionTargets = userInteractions.map(i => i.targetId);
		const similarUserInteractions = await this.userInteractionHistoryRepository.find({
			where: {
				targetId: In(interactionTargets),
				userId: user.id,
				interactionType: In(['like', 'renote', 'reply'])
			},
			take: 100
		});

		const noteInteractions = await this.noteReactionsRepository.count({
			where: {
				noteId: note.id,
				userId: In(similarUserInteractions.map(i => i.userId))
			}
		});

		const similarityScore = noteInteractions / Math.max(1, similarUserInteractions.length * 0.1);
		const collaborativeScore = Math.min(1, similarityScore);

		await this.redisClient.setex(cacheKey, 1800, collaborativeScore.toString());
		return collaborativeScore;
	}

	@bindThis
	private async calculateSmartDiversityBonus(note: MiNote, profile: UserProfile, user: MiUser): Promise<number> {
		const explorationFactor = profile.explorationFactor ?? 0.3;
		const diversityPreference = profile.diversityPreference ?? 0.5;

		const contentTypes = [];
		if (note.text && note.text.length > 0) contentTypes.push('text');
		if (note.fileIds && note.fileIds.length > 0) contentTypes.push('media');
		if (note.hasPoll) contentTypes.push('poll');
		if (note.replyId) contentTypes.push('reply');
		if (note.renoteId) contentTypes.push('renote');

		const typeVariety = contentTypes.length * 0.2;

		let topicNovelty = 0;
		if (note.tags && note.tags.length > 0) {
			for (const tag of note.tags) {
				const topicFrequency = profile.topics[tag] ?? 0;
				topicNovelty += (1 - topicFrequency) * 0.1;
			}
			topicNovelty = topicNovelty / note.tags.length;
		}

		const noteHour = this.idService.parse(note.id).date.getHours();
		const userActivityPattern = profile.temporalPatterns.timeOfDayActivity ?? {};
		const hourActivity = userActivityPattern[noteHour.toString()] ?? 0.5;
		const temporalNovelty = (1 - hourActivity) * 0.1;

		const recentAuthorInteractions = await this.userInteractionHistoryRepository.count({
			where: {
				userId: user.id,
				targetId: note.userId,
				targetType: 'user',
				createdAt: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
			}
		});
		const authorNovelty = recentAuthorInteractions === 0 ? 0.2 : Math.max(0, 0.2 - recentAuthorInteractions * 0.05);

		const totalDiversityBonus = (typeVariety + topicNovelty + temporalNovelty + authorNovelty) *
			(explorationFactor * 0.7 + diversityPreference * 0.3);

		return Math.min(0.5, totalDiversityBonus);
	}

	@bindThis
	private async calculateSerendipityScore(note: MiNote, user: MiUser, profile: UserProfile): Promise<number> {
		const explorationFactor = profile.explorationFactor ?? 0.3;
		if (explorationFactor < 0.2) return 0.1;

		const contentRelevance = await this.calculateEnhancedContentRelevance(note, profile, user);
		const unexpectedness = Math.max(0, 0.8 - contentRelevance);

		const qualityThreshold = await this.calculateContentQuality(note);
		if (qualityThreshold < 0.4) return 0;

		const networkTrust = await this.calculateNetworkEffect(user, note);

		const temporalUnexpectedness = 1 - this.calculateAdaptiveRecency(note, profile);

		const serendipityScore = (unexpectedness * 0.4 + networkTrust * 0.3 + temporalUnexpectedness * 0.2 + qualityThreshold * 0.1) * explorationFactor;

		return Math.min(0.4, serendipityScore);
	}

	@bindThis
	private async calculateAntiEchoChambering(note: MiNote, user: MiUser, profile: UserProfile): Promise<number> {
		const diversityPreference = profile.diversityPreference ?? 0.5;
		if (diversityPreference < 0.3) return 0;

		const followingIds = await this.getFollowingIds(user.id);
		const isFromOutsideNetwork = !followingIds.includes(note.userId);

		const isCrossInstance = !!note.userHost;

		let topicDiversityScore = 0;
		if (note.tags && note.tags.length > 0) {
			for (const tag of note.tags) {
				const userFamiliarity = profile.topics[tag] ?? 0;
				topicDiversityScore += (1 - userFamiliarity) / note.tags.length;
			}
		}

		const detectedLang = await this.recommendationAlgorithms.detectLanguage(note.text);
		const primaryLang = Object.keys(profile.languages).reduce((a, b) =>
			(profile.languages[a] || 0) > (profile.languages[b] || 0) ? a : b, 'en');
		const languageDiversity = detectedLang !== primaryLang ? 0.3 : 0;

		const qualityGate = await this.calculateContentQuality(note);
		if (qualityGate < 0.5) return 0;

		const antiEchoScore = (
			(isFromOutsideNetwork ? 0.3 : 0) +
			(isCrossInstance ? 0.2 : 0) +
			topicDiversityScore * 0.3 +
			languageDiversity
		) * diversityPreference * qualityGate;

		return Math.min(0.3, antiEchoScore);
	}

	@bindThis
	private findSemanticMatches(text: string, interest: string): number {
		const directMatches = (text.match(new RegExp(interest, 'gi')) || []).length;

		const relatedTerms = this.getRelatedTerms(interest);
		let relatedMatches = 0;
		for (const term of relatedTerms) {
			relatedMatches += (text.match(new RegExp(term, 'gi')) || []).length * 0.7;
		}

		return directMatches + relatedMatches;
	}

	@bindThis
	private getRelatedTerms(term: string): string[] {
		const relationships: Record<string, string[]> = {
			'technology': ['tech', 'coding', 'programming', 'software', 'development'],
			'music': ['song', 'artist', 'album', 'concert', 'musician'],
			'food': ['recipe', 'cooking', 'restaurant', 'meal', 'cuisine'],
			'travel': ['journey', 'vacation', 'trip', 'destination', 'tourism'],
			'sports': ['game', 'match', 'team', 'player', 'competition'],
			'art': ['creative', 'design', 'painting', 'drawing', 'artistic']
		};

		return relationships[term.toLowerCase()] ?? [];
	}

	@bindThis
	private extractTopicsFromText(text: string | null): string[] {
		if (!text) return [];

		const topicKeywords = ['technology', 'music', 'food', 'travel', 'sports', 'art', 'politics', 'science', 'gaming', 'movies'];
		const extractedTopics: string[] = [];

		for (const keyword of topicKeywords) {
			if (text.toLowerCase().includes(keyword)) {
				extractedTopics.push(keyword);
			}
		}

		return extractedTopics;
	}

	@bindThis
	private calculateSemanticTopicSimilarity(tag: string, userTopics: Record<string, number>): number {
		let maxSimilarity = 0;

		for (const [userTopic, weight] of Object.entries(userTopics)) {
			const similarity = this.calculateStringSimilarity(tag, userTopic);
			if (similarity > 0.6) {
				maxSimilarity = Math.max(maxSimilarity, similarity * weight);
			}
		}

		return maxSimilarity;
	}

	@bindThis
	private calculateStringSimilarity(str1: string, str2: string): number {
		const longer = str1.length > str2.length ? str1 : str2;
		const shorter = str1.length > str2.length ? str2 : str1;

		if (longer.length === 0) return 1.0;

		const distance = this.levenshteinDistance(longer, shorter);
		return (longer.length - distance) / longer.length;
	}

	@bindThis
	private levenshteinDistance(str1: string, str2: string): number {
		const matrix = [];
		for (let i = 0; i <= str2.length; i++) {
			matrix[i] = [i];
		}
		for (let j = 0; j <= str1.length; j++) {
			matrix[0][j] = j;
		}
		for (let i = 1; i <= str2.length; i++) {
			for (let j = 1; j <= str1.length; j++) {
				if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1,
						matrix[i][j - 1] + 1,
						matrix[i - 1][j] + 1
					);
				}
			}
		}
		return matrix[str2.length][str1.length];
	}

	@bindThis
	private analyzeSentiment(text: string | null): number {
		if (!text) return 0.5;

		const positiveWords = ['good', 'great', 'awesome', 'love', 'amazing', 'excellent', 'wonderful', 'fantastic'];
		const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'horrible', 'disgusting', 'worst', 'annoying'];

		const words = text.toLowerCase().split(/\s+/);
		let positiveCount = 0;
		let negativeCount = 0;

		for (const word of words) {
			if (positiveWords.includes(word)) positiveCount++;
			if (negativeWords.includes(word)) negativeCount++;
		}

		const totalSentimentWords = positiveCount + negativeCount;
		if (totalSentimentWords === 0) return 0.5;

		return positiveCount / totalSentimentWords;
	}

	@bindThis
	private async calculateCommunityAlignment(note: MiNote, profile: UserProfile): Promise<number> {
		let alignmentScore = 0.5;

		const contentTypeScore = this.calculateContentTypeMatch(note, profile);
		alignmentScore += contentTypeScore * 0.3;

		const languageScore = await this.calculateLanguageMatch(note, profile);
		alignmentScore += languageScore * 0.2;

		if (note.tags && note.tags.length > 0) {
			let topicAlignment = 0;
			for (const tag of note.tags) {
				const topicWeight = profile.topics[tag] ?? 0;
				topicAlignment += topicWeight;
			}
			const avgTopicAlignment = topicAlignment / note.tags.length;
			const moderatedAlignment = avgTopicAlignment > 0.8 ? 0.8 - (avgTopicAlignment - 0.8) : avgTopicAlignment;
			alignmentScore += moderatedAlignment * 0.5;
		}

		return Math.min(1, alignmentScore);
	}

	@bindThis
	public async getUserRecommendationProfile(userId: string) {
		return await this.buildUserProfile({ id: userId } as MiUser);
	}

	@bindThis
	public async buildUserProfile(user: MiUser) {
		return await this.getUserProfile(user.id);
	}

	@bindThis
	public async calculateUserAlignment(note: MiNote, profile: any): Promise<number> {
		return await this.calculateCommunityAlignment(note, profile);
	}

	@bindThis
	public calculateFreshnessScore(note: MiNote, freshnessWeight: number): number {
		const recency = this.calculateRecency(note);
		return recency * freshnessWeight;
	}

	@bindThis
	public async calculateSmartScore(
		note: MiNote,
		profile: any,
		user: MiUser,
		options: {
			algorithm: string;
			diversityLevel: string;
			freshnessWeight: number;
			qualityThreshold: number;
		}
	): Promise<number> {
		const alignmentScore = await this.calculateUserAlignment(note, profile);
		const freshnessScore = this.calculateFreshnessScore(note, options.freshnessWeight);
		const socialScore = await this.calculateSocialProof(note, user);

		let finalScore = alignmentScore * 0.4 + freshnessScore * options.freshnessWeight + socialScore * 0.3;

		if (options.algorithm === 'discovery') {
			finalScore += 0.2;
		}

		return Math.min(1, finalScore);
	}

	@bindThis
	private async getNotesWithMinimalJoins(noteIds: string[]): Promise<MiNote[]> {
		if (noteIds.length === 0) return [];

		const batchSize = 200;
		const allNotes: MiNote[] = [];

		for (let i = 0; i < noteIds.length; i += batchSize) {
			const batch = noteIds.slice(i, i + batchSize);

			const notes = await this.notesRepository.createQueryBuilder('note')
				.leftJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply', 'reply.visibility = :publicVisibility', { publicVisibility: 'public' })
				.leftJoinAndSelect('note.renote', 'renote', 'renote.visibility = :publicVisibility', { publicVisibility: 'public' })
				.leftJoinAndSelect('reply.user', 'replyUser', 'replyUser.isSuspended = false AND replyUser.isDeleted = false')
				.leftJoinAndSelect('renote.user', 'renoteUser', 'renoteUser.isSuspended = false AND renoteUser.isDeleted = false')
				.where('note.id IN (:...batch)', { batch })
				.andWhere('user.isSuspended = false')
				.andWhere('user.isDeleted = false')
				.getMany();

			allNotes.push(...notes);
		}

		const noteMap = new Map(allNotes.map(note => [note.id, note]));
		return noteIds.map(id => noteMap.get(id)).filter(Boolean) as MiNote[];
	}
}
