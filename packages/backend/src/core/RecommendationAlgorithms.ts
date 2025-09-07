/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type {
	HashtagsRepository,
	MiNote,
	MiUser,
	NoteFavoritesRepository,
	NoteReactionsRepository,
	NotesRepository,
	UserInteractionHistoryRepository
} from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { MoreThan } from 'typeorm';

export interface UserProfile {
	interests: Record<string, number>;
	contentTypes: Record<string, number>;
	languages: Record<string, number>;
	topics: Record<string, number>;
	socialFactors: Record<string, number>;
	temporalPatterns: Record<string, number>;
	qualityPreference: number;
	diversityPreference: number;
	explorationFactor: number;
}

@Injectable()
export class RecommendationAlgorithms {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		@Inject(DI.noteFavoritesRepository)
		private noteFavoritesRepository: NoteFavoritesRepository,

		@Inject(DI.userInteractionHistoryRepository)
		private userInteractionHistoryRepository: UserInteractionHistoryRepository,

		@Inject(DI.hashtagsRepository)
		private hashtagsRepository: HashtagsRepository,

		private idService: IdService,
	) {}

	@bindThis
	public async calculateContentRelevance(note: MiNote, profile: UserProfile): Promise<number> {
		if (!note.text) return 0.3;

		const text = note.text.toLowerCase();
		let relevanceScore = 0;
		let totalWeight = 0;

		for (const [interest, weight] of Object.entries(profile.interests)) {
			if (text.includes(interest.toLowerCase())) {
				relevanceScore += weight;
				totalWeight += weight;
			}
		}

		const textLength = note.text.length;
		const preferredLength = profile.temporalPatterns.preferredPostLength ?? 200;
		const lengthScore = 1 - Math.abs(textLength - preferredLength) / Math.max(textLength, preferredLength);
		relevanceScore += lengthScore * 0.2;
		totalWeight += 0.2;

		if (note.fileIds && note.fileIds.length > 0) {
			const mediaScore = profile.contentTypes.media ?? 0.5;
			relevanceScore += mediaScore * 0.3;
			totalWeight += 0.3;
		}

		return totalWeight > 0 ? Math.min(1, relevanceScore / totalWeight) : 0.5;
	}

	@bindThis
	public async calculateTopicMatch(note: MiNote, profile: UserProfile): Promise<number> {
		if (!note.tags || note.tags.length === 0) return 0.3;

		let topicScore = 0;
		let matchCount = 0;

		for (const tag of note.tags) {
			const topicWeight = profile.topics[tag] ?? 0;
			if (topicWeight > 0) {
				topicScore += topicWeight;
				matchCount++;
			}
		}

		const diversityBonus = matchCount > 1 ? Math.log(matchCount) * 0.1 : 0;

		return Math.min(1, (topicScore / Math.max(1, note.tags.length)) + diversityBonus);
	}

	@bindThis
	public async calculateLanguageMatch(note: MiNote, profile: UserProfile): Promise<number> {
		const detectedLang = await this.detectLanguage(note.text);
		return profile.languages[detectedLang] ?? 0.5;
	}

	@bindThis
	public calculateContentTypeMatch(note: MiNote, profile: UserProfile): number {
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

		if (note.renoteId && !note.text) {
			typeScore += profile.contentTypes.share ?? 0.4;
			typeCount++;
		}

		return typeCount > 0 ? typeScore / typeCount : 0.5;
	}

	@bindThis
	public async calculateAuthorRelevance(user: MiUser, note: MiNote, profile: UserProfile): Promise<number> {
		if (!note.user) return 0.5;

		const cacheKey = `author:relevance:${user.id}:${note.userId}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
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
	public async calculateSocialProof(note: MiNote, user: MiUser): Promise<number> {
		const cacheKey = `social:proof:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
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
	public calculateRecency(note: MiNote): number {
		const noteAge = Date.now() - this.idService.parse(note.id).date.getTime();
		const ageHours = noteAge / (1000 * 60 * 60);

		return Math.exp(-ageHours / 24);
	}

	@bindThis
	public async calculateTrendingScore(note: MiNote): Promise<number> {
		const cacheKey = `trending:${note.id}`;
		const cached = await this.redisClient.get(cacheKey);
		if (cached) {
			return parseFloat(cached);
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
	public async detectLanguage(text: string | null): Promise<string> {
		if (!text || text.trim().length < 10) return 'unknown';

		try {
			const cld = await import('cld');
			const result = await cld.default.detect(text);
			return result.languages[0]?.code || 'unknown';
		} catch {
			return 'unknown';
		}
	}
}
