/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type {
	UserInteractionHistoryRepository,
	UserRecommendationProfileRepository,
	NoteReactionsRepository,
	NoteFavoritesRepository,
	NotesRepository,
	HashtagsRepository,
	FollowingsRepository
} from '@/models/_.js';
import type { MiUser, MiNote, MiUserRecommendationProfile } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { LocalAIContentAnalysisService } from '@/core/LocalAIContentAnalysisService.js';
import { MoreThan, In } from 'typeorm';
import cld from 'cld';

@Injectable()
export class UserProfileLearningService {
	private readonly LEARNING_DECAY_FACTOR = 0.95;
	private readonly MIN_INTERACTIONS_FOR_UPDATE = 5;
	private readonly MAX_PROFILE_AGE_DAYS = 7;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userInteractionHistoryRepository)
		private userInteractionHistoryRepository: UserInteractionHistoryRepository,

		@Inject(DI.userRecommendationProfileRepository)
		private userRecommendationProfileRepository: UserRecommendationProfileRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		@Inject(DI.noteFavoritesRepository)
		private noteFavoritesRepository: NoteFavoritesRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.hashtagsRepository)
		private hashtagsRepository: HashtagsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private idService: IdService,
		private localAIContentAnalysisService: LocalAIContentAnalysisService,
	) {}

	@bindThis
	public async updateUserProfile(userId: string): Promise<MiUserRecommendationProfile> {
		let profile = await this.userRecommendationProfileRepository.findOneBy({ userId });

		if (!profile) {
			profile = await this.createInitialProfile(userId);
		}

		const recentInteractions = await this.getRecentInteractions(userId);

		if (recentInteractions.length < this.MIN_INTERACTIONS_FOR_UPDATE) {
			return profile;
		}

		const updatedProfile = await this.learnFromInteractions(profile, recentInteractions);

		await this.userRecommendationProfileRepository.save(updatedProfile);

		await this.redisClient.del(`user:profile:${userId}`);

		return updatedProfile;
	}

	@bindThis
	private async createInitialProfile(userId: string): Promise<MiUserRecommendationProfile> {
		let profile = await this.userRecommendationProfileRepository.findOneBy({ userId });
		if (profile) {
			return profile;
		}

		const newProfile = this.userRecommendationProfileRepository.create({
			id: this.idService.gen(),
			userId,
			interestCategories: {},
			contentTypePreferences: {
				text: 0.7,
				media: 0.6,
				poll: 0.5,
				conversation: 0.6,
				share: 0.4,
			},
			languagePreferences: {
				en: 0.7,
				ja: 0.5,
			},
			topicPreferences: {},
			interactionPatterns: {
				averageEngagementTime: 30,
				preferredPostLength: 200,
				reactionPatterns: {},
				timeOfDayActivity: {},
				dayOfWeekActivity: {},
			},
			socialPreferences: {
				followingInfluence: 0.6,
				mutualConnectionWeight: 0.4,
				popularityBias: 0.3,
				diversityPreference: 0.5,
			},
			explorationFactor: 0.3,
			recencyWeight: 0.7,
			qualityThreshold: 0.6,
			lastLearningUpdate: new Date(),
			learningDataPoints: 0,
			confidenceScore: 0.1,
		});

		try {
			return await this.userRecommendationProfileRepository.save(newProfile);
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
	private async getRecentInteractions(userId: string): Promise<any[]> {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

		return await this.userInteractionHistoryRepository.find({
			where: {
				userId,
				createdAt: MoreThan(thirtyDaysAgo),
			},
			order: { createdAt: 'DESC' },
			take: 500,
		});
	}

	@bindThis
	private async learnFromInteractions(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<MiUserRecommendationProfile> {
		await this.updateContentTypePreferences(profile, interactions);

		await this.updateTopicPreferences(profile, interactions);

		await this.updateTemporalPatterns(profile, interactions);

		await this.updateLanguagePreferences(profile, interactions);

		await this.updateSocialPreferences(profile, interactions);

		await this.updateAIContentPreferences(profile, interactions);

		profile.lastLearningUpdate = new Date();
		profile.learningDataPoints = interactions.length;
		profile.confidenceScore = Math.min(1, interactions.length / 100);

		return profile;
	}

	@bindThis
	private async updateContentTypePreferences(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		const typeInteractions = {
			text: 0,
			media: 0,
			poll: 0,
			conversation: 0,
			share: 0,
		};

		const noteIds = interactions
			.filter(i => i.targetType === 'note' && ['like', 'reply', 'renote', 'bookmark'].includes(i.interactionType))
			.map(i => i.targetId);

		if (noteIds.length === 0) return;

		const notes = await this.notesRepository.find({
			where: { id: In(noteIds) },
			select: { id: true, text: true, fileIds: true, hasPoll: true, replyId: true, renoteId: true },
		});

		for (const note of notes) {
			const weight = this.getInteractionWeight(interactions, note.id);

			if (note.text && note.text.length > 0) {
				typeInteractions.text += weight;
			}
			if (note.fileIds && note.fileIds.length > 0) {
				typeInteractions.media += weight;
			}
			if (note.hasPoll) {
				typeInteractions.poll += weight;
			}
			if (note.replyId) {
				typeInteractions.conversation += weight;
			}
			if (note.renoteId && !note.text) {
				typeInteractions.share += weight;
			}
		}

		const currentPrefs = profile.contentTypePreferences;
		const totalInteractions = Object.values(typeInteractions).reduce((a, b) => a + b, 0);

		if (totalInteractions > 0) {
			for (const [type, count] of Object.entries(typeInteractions)) {
				const newPreference = count / totalInteractions;
				const currentPreference = currentPrefs[type] ?? 0.5;
				currentPrefs[type] = currentPreference * this.LEARNING_DECAY_FACTOR +
					newPreference * (1 - this.LEARNING_DECAY_FACTOR);
			}
		}

		profile.contentTypePreferences = currentPrefs;
	}

	@bindThis
	private async updateTopicPreferences(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		const topicInteractions: Record<string, number> = {};

		const noteIds = interactions
			.filter(i => i.targetType === 'note' && ['like', 'reply', 'renote', 'bookmark'].includes(i.interactionType))
			.map(i => i.targetId);

		if (noteIds.length === 0) return;

		const notes = await this.notesRepository.find({
			where: { id: In(noteIds) },
			select: { id: true, tags: true },
		});

		for (const note of notes) {
			if (!note.tags || note.tags.length === 0) continue;

			const weight = this.getInteractionWeight(interactions, note.id);

			for (const tag of note.tags) {
				topicInteractions[tag] = (topicInteractions[tag] ?? 0) + weight;
			}
		}

		const currentTopics = profile.topicPreferences;
		const totalInteractions = Object.values(topicInteractions).reduce((a, b) => a + b, 0);

		if (totalInteractions > 0) {
			for (const [topic, count] of Object.entries(topicInteractions)) {
				const newPreference = count / totalInteractions;
				const currentPreference = currentTopics[topic] ?? 0;
				currentTopics[topic] = currentPreference * this.LEARNING_DECAY_FACTOR +
					newPreference * (1 - this.LEARNING_DECAY_FACTOR);
			}
		}

		profile.topicPreferences = currentTopics;
	}

	@bindThis
	private async updateTemporalPatterns(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		const timeOfDayActivity: Record<string, number> = {};
		const dayOfWeekActivity: Record<string, number> = {};

		for (const interaction of interactions) {
			const date = new Date(interaction.createdAt);
			const hour = date.getHours();
			const dayOfWeek = date.getDay();

			timeOfDayActivity[hour.toString()] = (timeOfDayActivity[hour.toString()] ?? 0) + interaction.weight;
			dayOfWeekActivity[dayOfWeek.toString()] = (dayOfWeekActivity[dayOfWeek.toString()] ?? 0) + interaction.weight;
		}

		const totalTimeActivity = Object.values(timeOfDayActivity).reduce((a, b) => a + b, 0);
		const totalDayActivity = Object.values(dayOfWeekActivity).reduce((a, b) => a + b, 0);

		if (totalTimeActivity > 0) {
			for (const hour of Object.keys(timeOfDayActivity)) {
				timeOfDayActivity[hour] /= totalTimeActivity;
			}
		}

		if (totalDayActivity > 0) {
			for (const day of Object.keys(dayOfWeekActivity)) {
				dayOfWeekActivity[day] /= totalDayActivity;
			}
		}

		profile.interactionPatterns = {
			...profile.interactionPatterns,
			timeOfDayActivity,
			dayOfWeekActivity,
		};
	}

	@bindThis
	private getInteractionWeight(interactions: any[], targetId: string): number {
		const interaction = interactions.find(i => i.targetId === targetId);
		if (!interaction) return 0;

		const weights = {
			like: 1.0,
			reply: 2.0,
			renote: 1.5,
			bookmark: 2.5,
			view: 0.1,
			dwell: 0.5,
		};

		let baseWeight = weights[interaction.interactionType as keyof typeof weights] ?? 1.0;

		if (interaction.interactionType === 'dwell' && interaction.context?.dwellTime) {
			const dwellTime = interaction.context.dwellTime;
			const visibility = interaction.context.maxVisibility || 50;

			const timeMultiplier = Math.min(3.0, Math.log(dwellTime + 1) * 0.5);
			const visibilityMultiplier = visibility / 100;

			baseWeight = baseWeight * timeMultiplier * visibilityMultiplier;
		}

		return baseWeight;
	}

	@bindThis
	private async updateLanguagePreferences(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		const languageInteractions: Record<string, number> = {};

		const noteIds = interactions
			.filter(i => i.targetType === 'note' && ['like', 'reply', 'renote', 'bookmark', 'dwell'].includes(i.interactionType))
			.map(i => i.targetId);

		if (noteIds.length === 0) return;

		const notes = await this.notesRepository.find({
			where: { id: In(noteIds) },
			select: { id: true, text: true },
		});

		for (const note of notes) {
			const weight = this.getInteractionWeight(interactions, note.id);

			let language = null;
			if (note.text && note.text.trim().length >= 10) {
				try {
					language = await this.detectLanguage(note.text);
				} catch (error) {
					console.debug('Language detection failed:', error);
					language = 'unknown';
				}
			}

			if (!language) {
				language = 'unknown';
			}

			languageInteractions[language] = (languageInteractions[language] ?? 0) + weight;
		}

		const currentPrefs = profile.languagePreferences ?? {};
		const totalInteractions = Object.values(languageInteractions).reduce((a, b) => a + b, 0);

		if (totalInteractions > 0) {
			for (const [lang, count] of Object.entries(languageInteractions)) {
				const newPreference = count / totalInteractions;
				const currentPreference = currentPrefs[lang] ?? 0.1;

				currentPrefs[lang] = currentPreference * this.LEARNING_DECAY_FACTOR +
					newPreference * (1 - this.LEARNING_DECAY_FACTOR);
			}
		}

		const totalWeight = Object.values(currentPrefs).reduce((a, b) => a + b, 0);
		if (totalWeight > 0) {
			for (const lang of Object.keys(currentPrefs)) {
				currentPrefs[lang] = currentPrefs[lang] / totalWeight;
			}
		}

		profile.languagePreferences = currentPrefs;
	}

	@bindThis
	private async detectLanguage(text: string): Promise<string | null> {
		if (!text || text.trim().length < 10) return null;

		try {
			const result = await cld.detect(text);

			if (result.reliable && result.languages && result.languages.length > 0) {
				const primaryLanguage = result.languages[0];
				if (primaryLanguage.percent >= 60) {
					return primaryLanguage.code.toLowerCase();
				}
			}

			return null;
		} catch (error) {
			console.debug('CLD language detection not available:', error);
			return null;
		}
	}

	@bindThis
	private async updateSocialPreferences(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		let followingInfluenceWeight = 0;
		let mutualConnectionWeight = 0;
		let popularityBiasWeight = 0;
		let diversityPreferenceWeight = 0;
		let totalInteractions = 0;

		const noteIds = interactions
			.filter(i => i.targetType === 'note' && ['like', 'reply', 'renote', 'bookmark', 'dwell'].includes(i.interactionType))
			.map(i => i.targetId);

		if (noteIds.length === 0) return;

		const notes = await this.notesRepository.find({
			where: { id: In(noteIds) },
			relations: { user: true },
			select: {
				id: true,
				userId: true,
				user: {
					id: true,
					followersCount: true,
					followingCount: true,
				}
			}
		});

		const currentUserFollowings = await this.getFollowingIds(profile.userId);
		const followingSet = new Set(currentUserFollowings);

		const mutualFollowings = await this.getMutualFollowingIds(profile.userId);
		const mutualSet = new Set(mutualFollowings);

		for (const note of notes) {
			if (!note.user) continue;

			const weight = this.getInteractionWeight(interactions, note.id);
			totalInteractions += weight;

			if (followingSet.has(note.userId)) {
				followingInfluenceWeight += weight;
			}

			if (mutualSet.has(note.userId)) {
				mutualConnectionWeight += weight;
			}

			const authorPopularity = Math.log(note.user.followersCount + 1);
			const popularityThreshold = 7;
			if (authorPopularity > popularityThreshold) {
				popularityBiasWeight += weight;
			}

			const followerFollowingRatio = note.user.followersCount / Math.max(note.user.followingCount, 1);
			if (followerFollowingRatio > 0.1 && followerFollowingRatio < 10) {
				diversityPreferenceWeight += weight;
			}
		}

		if (totalInteractions > 0) {
			const newPrefs = {
				followingInfluence: followingInfluenceWeight / totalInteractions,
				mutualConnectionWeight: mutualConnectionWeight / totalInteractions,
				popularityBias: popularityBiasWeight / totalInteractions,
				diversityPreference: diversityPreferenceWeight / totalInteractions,
			};

			const currentPrefs = profile.socialPreferences;

			currentPrefs.followingInfluence = (currentPrefs.followingInfluence ?? 0.6) * this.LEARNING_DECAY_FACTOR +
				newPrefs.followingInfluence * (1 - this.LEARNING_DECAY_FACTOR);

			currentPrefs.mutualConnectionWeight = (currentPrefs.mutualConnectionWeight ?? 0.4) * this.LEARNING_DECAY_FACTOR +
				newPrefs.mutualConnectionWeight * (1 - this.LEARNING_DECAY_FACTOR);

			currentPrefs.popularityBias = (currentPrefs.popularityBias ?? 0.3) * this.LEARNING_DECAY_FACTOR +
				newPrefs.popularityBias * (1 - this.LEARNING_DECAY_FACTOR);

			currentPrefs.diversityPreference = (currentPrefs.diversityPreference ?? 0.5) * this.LEARNING_DECAY_FACTOR +
				newPrefs.diversityPreference * (1 - this.LEARNING_DECAY_FACTOR);

			profile.socialPreferences = currentPrefs;
		}
	}

	@bindThis
	private async getFollowingIds(userId: string): Promise<string[]> {
		const followings = await this.followingsRepository.find({
			where: { followerId: userId },
			select: { followeeId: true },
		});

		return followings.map(f => f.followeeId);
	}

	@bindThis
	private async getMutualFollowingIds(userId: string): Promise<string[]> {
		const mutualFollowings = await this.followingsRepository
			.createQueryBuilder('following1')
			.innerJoin(
				'following',
				'following2',
				'following1.followeeId = following2.followerId AND following1.followerId = following2.followeeId'
			)
			.where('following1.followerId = :userId', { userId })
			.select('following1.followeeId', 'followeeId')
			.getRawMany();

		return mutualFollowings.map(f => f.followeeId);
	}

	@bindThis
	private async updateAIContentPreferences(
		profile: MiUserRecommendationProfile,
		interactions: any[]
	): Promise<void> {
		if (!this.localAIContentAnalysisService.isFeatureEnabled()) {
			return;
		}

		const noteIds = interactions
			.filter(i => i.targetType === 'note' && ['like', 'reply', 'renote', 'bookmark', 'dwell'].includes(i.interactionType))
			.map(i => i.targetId);

		if (noteIds.length === 0) return;

		const notes = await this.notesRepository.find({
			where: { id: In(noteIds) },
			select: { id: true, text: true, cw: true },
		});

		const sentimentPreferences = { positive: 0, negative: 0, neutral: 0 };
		const topicPreferences: Record<string, number> = {};
		const qualityPreferences = { high: 0, medium: 0, low: 0 };
		let totalWeight = 0;

		for (const note of notes) {
			const weight = this.getInteractionWeight(interactions, note.id);
			totalWeight += weight;

			try {
				const analysis = await this.localAIContentAnalysisService.analyzeContentWithStrategy(note, true);

				if (analysis && analysis.features) {
					const { features } = analysis;

					if (features.sentiment.score > 0.3) {
						sentimentPreferences.positive += weight;
					} else if (features.sentiment.score < -0.3) {
						sentimentPreferences.negative += weight;
					} else {
						sentimentPreferences.neutral += weight;
					}

					for (const topic of features.topics.topics) {
						const topicName = `ai_${topic.name}`;
						topicPreferences[topicName] = (topicPreferences[topicName] ?? 0) +
							weight * topic.confidence;
					}

					const qualityScore = (features.quality.readabilityScore + features.quality.coherenceScore + features.quality.lengthScore) / 3;
					if (qualityScore > 0.7) {
						qualityPreferences.high += weight;
					} else if (qualityScore > 0.4) {
						qualityPreferences.medium += weight;
					} else {
						qualityPreferences.low += weight;
					}
				}
			} catch (error) {
				console.debug('Failed to analyze content for learning:', error);
			}
		}

		if (totalWeight === 0) return;

		const currentTopics = profile.topicPreferences ?? {};

		for (const [topic, weight] of Object.entries(topicPreferences)) {
			const normalizedWeight = weight / totalWeight;
			const currentPreference = currentTopics[topic] ?? 0;
			currentTopics[topic] = currentPreference * this.LEARNING_DECAY_FACTOR +
				normalizedWeight * (1 - this.LEARNING_DECAY_FACTOR);
		}

		profile.topicPreferences = currentTopics;

		const currentCategories = profile.interestCategories ?? {};

		const totalSentiment = Object.values(sentimentPreferences).reduce((a, b) => a + b, 0);
		if (totalSentiment > 0) {
			for (const [sentiment, count] of Object.entries(sentimentPreferences)) {
				const categoryKey = `sentiment_${sentiment}`;
				const normalizedWeight = count / totalSentiment;
				const currentPreference = currentCategories[categoryKey] ?? 0;
				currentCategories[categoryKey] = currentPreference * this.LEARNING_DECAY_FACTOR +
					normalizedWeight * (1 - this.LEARNING_DECAY_FACTOR);
			}
		}

		const totalQuality = Object.values(qualityPreferences).reduce((a, b) => a + b, 0);
		if (totalQuality > 0) {
			for (const [quality, count] of Object.entries(qualityPreferences)) {
				const categoryKey = `quality_${quality}`;
				const normalizedWeight = count / totalQuality;
				const currentPreference = currentCategories[categoryKey] ?? 0;
				currentCategories[categoryKey] = currentPreference * this.LEARNING_DECAY_FACTOR +
					normalizedWeight * (1 - this.LEARNING_DECAY_FACTOR);
			}
		}

		profile.interestCategories = currentCategories;

		const avgQualityPreference =
			(qualityPreferences.high * 0.9 + qualityPreferences.medium * 0.6 + qualityPreferences.low * 0.3) / totalWeight;

		if (avgQualityPreference > 0) {
			profile.qualityThreshold = profile.qualityThreshold * this.LEARNING_DECAY_FACTOR +
				avgQualityPreference * (1 - this.LEARNING_DECAY_FACTOR);
		}
	}
}
