/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiUser, UsersRepository, NotesRepository, FollowingsRepository, UserProfilesRepository, AbuseUserReportsRepository, MutingsRepository, SigninsRepository, UserIpsRepository, UserSessionsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { UtilityService } from '@/core/UtilityService.js';
import { DynamicScoringService } from '@/core/DynamicScoringService.js';
import { RiskEventLogService } from '@/core/RiskEventLogService.js';
import { RiskScoreRehabilitationService } from '@/core/RiskScoreRehabilitationService.js';
import { IdService } from '@/core/IdService.js';
import { IP2LocationService } from '@/core/IP2LocationService.js';
import { MultiAccountDetectionService } from '@/core/MultiAccountDetectionService.js';
import { MoreThan, IsNull, Not, In } from 'typeorm';
import * as Redis from 'ioredis';
import { createHash } from 'node:crypto';

export interface DimensionWeight {
	weight: number;
	maxScore: number;
	enabled: boolean;
	threshold?: {
		critical?: number;
		high?: number;
		medium?: number;
		low?: number;
	};
}

export interface RiskScoreConfig {
	dimensions: {
		accountAge: DimensionWeight;
		emailVerified: DimensionWeight;
		avatarExists: DimensionWeight;
		profileComplete: DimensionWeight;
		twoFactorEnabled: DimensionWeight;

		loginFrequency: DimensionWeight;
		loginTimePattern: DimensionWeight;
		ipChangeFrequency: DimensionWeight;
		deviceDiversity: DimensionWeight;
		sessionDuration: DimensionWeight;
		failedLoginAttempts: DimensionWeight;

		postingFrequency: DimensionWeight;
		postingTimePattern: DimensionWeight;
		contentDiversity: DimensionWeight;
		mediaUsagePattern: DimensionWeight;
		interactionPattern: DimensionWeight;

		followRatio: DimensionWeight;
		mutualFollowRate: DimensionWeight;
		socialGraphDensity: DimensionWeight;
		interactionReciprocity: DimensionWeight;

		averageNoteLength: DimensionWeight;
		hashtagUsage: DimensionWeight;
		mentionFrequency: DimensionWeight;
		urlUsage: DimensionWeight;

		reportedCount: DimensionWeight;
		blockedByCount: DimensionWeight;

		rateLimitHits: DimensionWeight;
		apiUsagePattern: DimensionWeight;
	};
	totalScoreThresholds: {
		poor: number;
		fair: number;
		good: number;
		veryGood: number;
		excellent: number;
	};
}

export interface RiskScoreDimensions {
	accountAge: number;
	emailVerified: number;
	avatarExists: number;
	profileComplete: number;
	twoFactorEnabled: number;

	loginFrequency: number;
	loginTimePattern: number;
	ipChangeFrequency: number;
	deviceDiversity: number;
	sessionDuration: number;
	failedLoginAttempts: number;

	postingFrequency: number;
	postingTimePattern: number;
	contentDiversity: number;
	mediaUsagePattern: number;
	interactionPattern: number;

	followRatio: number;
	mutualFollowRate: number;
	socialGraphDensity: number;
	interactionReciprocity: number;

	averageNoteLength: number;
	hashtagUsage: number;
	mentionFrequency: number;
	urlUsage: number;

	reportedCount: number;
	blockedByCount: number;

	rateLimitHits: number;
	apiUsagePattern: number;
}

export interface UserRiskScore {
	userId: string;
	totalScore: number;
	riskLevel: 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent';
	dimensions: RiskScoreDimensions;
	details: {
		strengths: string[];
		concerns: string[];
		recommendations: string[];
	};
	calculatedAt: Date;
}

@Injectable()
export class UserRiskScoreService implements OnApplicationShutdown {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.abuseUserReportsRepository)
		private abuseUserReportsRepository: AbuseUserReportsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userIpsRepository)
		private userIpsRepository: UserIpsRepository,

		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		private utilityService: UtilityService,
		private dynamicScoringService: DynamicScoringService,
		private riskEventLogService: RiskEventLogService,
		private rehabilitationService: RiskScoreRehabilitationService,
		private idService: IdService,
		private ip2LocationService: IP2LocationService,
		private multiAccountDetectionService: MultiAccountDetectionService,
	) {
		this.initializeConfig().catch(err => {
			console.error('Failed to initialize risk score configuration:', err);
		});
	}

	private config: RiskScoreConfig | null = null;
	private baselines: Map<string, number> = new Map();
	private lastBaselineUpdate: Date | null = null;

	@bindThis
	public async initializeConfig(): Promise<void> {
		const cachedConfig = await this.redisClient.get('risk-score:config');
		if (cachedConfig) {
			this.config = JSON.parse(cachedConfig);
		} else {
			this.config = await this.getDefaultConfig();
			await this.redisClient.set('risk-score:config', JSON.stringify(this.config), 'EX', 3600);
		}

		await this.updateBaselines();
	}

	@bindThis
	private async updateBaselines(): Promise<void> {
		if (this.lastBaselineUpdate &&
			(Date.now() - this.lastBaselineUpdate.getTime()) < 3600000) {
			return;
		}

		try {
			const cachedBaselines = await this.redisClient.get('risk-score:baselines');
			if (cachedBaselines) {
				const entries = JSON.parse(cachedBaselines);
				this.baselines = new Map(entries);
				this.lastBaselineUpdate = new Date();
				return;
			}

			const sampleUsers = await this.usersRepository.find({
				where: {
					lastActiveDate: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
					host: IsNull(),
					isSuspended: false,
					isDeleted: false,
				},
				select: ['id', 'notesCount', 'followersCount', 'followingCount', 'riskScore'],
				take: 2000,
			});

			if (sampleUsers.length < 100) {
				console.warn('Insufficient sample size for baseline calculation');
				this.setDefaultBaselines();
				return;
			}

			const activeUsers = sampleUsers.filter(u => u.notesCount > 0);
			const normalUsers = activeUsers.filter(u => !u.riskScore || u.riskScore >= 55);

			const metrics = {
				notesCount: normalUsers.map(u => u.notesCount).sort((a, b) => a - b),
				followersCount: normalUsers.map(u => u.followersCount).sort((a, b) => a - b),
				followingCount: normalUsers.map(u => u.followingCount).sort((a, b) => a - b),
			};

			for (const [key, values] of Object.entries(metrics)) {
				if (values.length > 0) {
					const q25 = values[Math.floor(values.length * 0.25)];
					const median = values[Math.floor(values.length * 0.5)];
					const q75 = values[Math.floor(values.length * 0.75)];
					const mean = values.reduce((a, b) => a + b, 0) / values.length;

					this.baselines.set(key, median);
					this.baselines.set(`${key}_q25`, q25);
					this.baselines.set(`${key}_q75`, q75);
					this.baselines.set(`${key}_mean`, mean);
				}
			}

			const riskScores = normalUsers
				.filter(u => u.riskScore && u.riskScore > 0)
				.map(u => u.riskScore!)
				.sort((a, b) => a - b);

			if (riskScores.length > 0) {
				const scoreMedian = riskScores[Math.floor(riskScores.length * 0.5)];
				const scoreMean = riskScores.reduce((a, b) => a + b, 0) / riskScores.length;
				this.baselines.set('riskScore_median', scoreMedian);
				this.baselines.set('riskScore_mean', scoreMean);
				this.baselines.set('scoreDistribution', riskScores.slice(0, 1000) as any);
			}

			this.lastBaselineUpdate = new Date();

			await this.redisClient.set('risk-score:baselines', JSON.stringify(Array.from(this.baselines.entries())), 'EX', 14400);
			console.log(`Updated baselines with ${normalUsers.length} normal users (median score: ${this.baselines.get('riskScore_median') || 'N/A'})`);
		} catch (error) {
			console.error('Failed to update risk score baselines:', error);
			this.setDefaultBaselines();
		}
	}

	@bindThis
	private setDefaultBaselines(): void {
		this.baselines.set('notesCount', 150);
		this.baselines.set('followersCount', 75);
		this.baselines.set('followingCount', 120);
		this.baselines.set('riskScore_median', 72);
		this.baselines.set('riskScore_mean', 70);
		this.baselines.set('scoreDistribution', Array.from({ length: 100 }, (_, i) => 50 + i * 0.5) as any);
		this.lastBaselineUpdate = new Date();
	}

	@bindThis
	public async calculateUserRiskScore(userId: string): Promise<UserRiskScore> {
		try {
			if (!this.config) {
				await this.initializeConfig();
			}

			const user = await this.usersRepository.findOneBy({ id: userId });
			if (!user) {
				console.warn(`User ${userId} not found for risk score calculation`);
				return this.createDefaultRiskScore(userId);
			}

			const profile = await this.userProfilesRepository.findOneBy({ userId });
			if (!profile) {
				console.warn(`User profile ${userId} not found for risk score calculation`);
				return this.createMinimalRiskScore(userId, user);
			}

		const dimensions: RiskScoreDimensions = {
			accountAge: await this.calculateAccountAgeScore(user),
			emailVerified: await this.normalizeScore(profile.emailVerified ? 1 : 0, 'emailVerified', userId),
			avatarExists: await this.normalizeScore(user.avatarId ? 1 : 0, 'avatarExists', userId),
			profileComplete: await this.normalizeScore(this.calculateProfileCompleteScore(user, profile), 'profileComplete', userId),
			twoFactorEnabled: await this.normalizeScore(profile.twoFactorEnabled ? 1 : 0, 'twoFactorEnabled', userId),

			loginFrequency: await this.calculateLoginFrequencyScore(userId),
			loginTimePattern: await this.calculateLoginTimePatternScore(userId),
			ipChangeFrequency: await this.calculateIpChangeFrequencyScore(userId),
			deviceDiversity: await this.calculateDeviceDiversityScore(userId),
			sessionDuration: await this.calculateSessionDurationScore(userId),
			failedLoginAttempts: await this.calculateFailedLoginAttemptsScore(userId),

			postingFrequency: await this.calculatePostingFrequencyScore(userId),
			postingTimePattern: await this.calculatePostingTimePatternScore(userId),
			contentDiversity: await this.calculateContentDiversityScore(userId),
			mediaUsagePattern: await this.calculateMediaUsageScore(userId),
			interactionPattern: await this.calculateInteractionPatternScore(userId),

			followRatio: await this.calculateFollowRatioScore(user),
			mutualFollowRate: await this.calculateMutualFollowScore(userId),
			socialGraphDensity: await this.calculateSocialGraphDensityScore(userId),
			interactionReciprocity: await this.calculateInteractionReciprocityScore(userId),

			averageNoteLength: await this.calculateAverageNoteLengthScore(userId),
			hashtagUsage: await this.calculateHashtagUsageScore(userId),
			mentionFrequency: await this.calculateMentionFrequencyScore(userId),
			urlUsage: await this.calculateUrlUsageScore(userId),

			reportedCount: await this.calculateReportedScore(userId),
			blockedByCount: await this.calculateBlockedScore(userId),

			rateLimitHits: await this.calculateRateLimitScore(userId),
			apiUsagePattern: await this.calculateApiUsagePatternScore(userId),
		};

		let totalScore = await this.calculateTotalScore(dimensions);

			totalScore = await this.multiAccountDetectionService.applyLinkPenalty(totalScore, userId);

			const rehabilitationFactor = await this.rehabilitationService.calculateRehabilitationFactors(userId, totalScore, dimensions as unknown as Record<string, number>);
		totalScore = await this.applyScoreAdjustmentDynamics(totalScore, rehabilitationFactor.finalAdjustment);

		const riskLevel = await this.determineRiskLevel(totalScore);
		const details: any = this.generateDetails(dimensions, totalScore);

			const requestPatternRisk = await this.multiAccountDetectionService.analyzeRequestPatternRisk(userId);
		if (requestPatternRisk.riskScore > 0) {
			totalScore = Math.min(100, totalScore + requestPatternRisk.riskScore * 0.3);
			if (requestPatternRisk.factors.length > 0) {
				details.riskFactors = requestPatternRisk.factors;
			}
		}

		const result: UserRiskScore = {
			userId,
			totalScore,
			riskLevel,
			dimensions,
			details,
			calculatedAt: new Date(),
		};

			await this.redisClient.set(
			`user:risk-score:${userId}`,
			JSON.stringify(result),
			'EX',
			86400
		);

			await this.usersRepository.update(userId, {
			riskScore: totalScore,
			riskLevel,
			riskScoreUpdatedAt: new Date(),
		});

			await this.multiAccountDetectionService.onUserRiskScoreUpdate(userId, totalScore);

			await this.saveHistoricalData(userId, totalScore, dimensions);

		return result;
		} catch (error) {
			console.error(`Error calculating risk score for user ${userId}:`, error);
			return this.createDefaultRiskScore(userId);
		}
	}

	@bindThis
	private createDefaultRiskScore(userId: string): UserRiskScore {
		return {
			userId,
			totalScore: 65,
			riskLevel: 'good',
			dimensions: this.createDefaultDimensions(),
			details: {
				strengths: [],
				concerns: ['Insufficient data for accurate risk assessment'],
				recommendations: ['User activity required for accurate scoring'],
			},
			calculatedAt: new Date(),
		};
	}

	@bindThis
	private createMinimalRiskScore(userId: string, user: MiUser): UserRiskScore {
		const dimensions = this.createDefaultDimensions();

		const createdAt = this.idService.parse(user.id).date;
		const accountAge = Date.now() - createdAt.getTime();
		const days = accountAge / (1000 * 60 * 60 * 24);

		dimensions.accountAge = Math.min(5, Math.log(days + 1) / Math.log(365));
		dimensions.avatarExists = user.avatarId ? 1 : 0;

		const totalScore = (dimensions.accountAge * 8 + dimensions.avatarExists * 5) + 55;

		return {
			userId,
			totalScore: Math.min(100, Math.max(0, totalScore)),
			riskLevel: totalScore >= 87 ? 'excellent' : totalScore >= 76 ? 'veryGood' : totalScore >= 65 ? 'good' : totalScore >= 55 ? 'fair' : 'poor',
			dimensions,
			details: {
				strengths: user.avatarId ? ['Has avatar'] : [],
				concerns: ['Limited profile information', 'User profile incomplete'],
				recommendations: ['Complete user profile', 'Add profile information'],
			},
			calculatedAt: new Date(),
		};
	}

	@bindThis
	private createDefaultDimensions(): RiskScoreDimensions {
		return {
			accountAge: 0.7,
			emailVerified: 0.6,
			avatarExists: 0.6,
			profileComplete: 0.5,
			twoFactorEnabled: 0.4,

			loginFrequency: 0.7,
			loginTimePattern: 0.7,
			ipChangeFrequency: 0.8,
			deviceDiversity: 0.7,
			sessionDuration: 0.7,
			failedLoginAttempts: 1.0,

			postingFrequency: 0.7,
			postingTimePattern: 0.7,
			contentDiversity: 0.7,
			mediaUsagePattern: 0.7,
			interactionPattern: 0.7,

			followRatio: 0.7,
			mutualFollowRate: 0.7,
			socialGraphDensity: 0.6,
			interactionReciprocity: 0.6,

			averageNoteLength: 0.7,
			hashtagUsage: 0.7,
			mentionFrequency: 0.7,
			urlUsage: 0.7,

			reportedCount: 1.0,
			blockedByCount: 1.0,

			rateLimitHits: 1.0,
			apiUsagePattern: 0.8,
		};
	}

	@bindThis
	private async calculateAccountAgeScore(user: MiUser): Promise<number> {
		const createdAt = this.idService.parse(user.id).date;
		const accountAge = Date.now() - createdAt.getTime();
		const days = accountAge / (1000 * 60 * 60 * 24);

		try {
			const populationContext = await this.dynamicScoringService.calculateDynamicScore(
				'accountAge',
				accountAge,
				user.id
			);

			return populationContext.adjustedScore;
		} catch (error) {
			console.warn(`Dynamic scoring failed for accountAge (user ${user.id}), using static calculation:`, error);
			const maxBonusDays = 730;
			const registrationBonus = Math.log(days + 1) / Math.log(maxBonusDays + 1);
			return Math.min(10, registrationBonus * 10);
		}
	}

	@bindThis
	private async getDefaultConfig(): Promise<RiskScoreConfig> {
		return {
			dimensions: {
				accountAge: { weight: 3, maxScore: 100, enabled: true },
				emailVerified: { weight: 3, maxScore: 10, enabled: true },
				avatarExists: { weight: 2, maxScore: 10, enabled: true },
				profileComplete: { weight: 2, maxScore: 10, enabled: true },
				twoFactorEnabled: { weight: 5, maxScore: 10, enabled: true },

				loginFrequency: { weight: 3, maxScore: 10, enabled: true },
				loginTimePattern: { weight: 3, maxScore: 10, enabled: true },
				ipChangeFrequency: { weight: 4, maxScore: 10, enabled: true },
				deviceDiversity: { weight: 3, maxScore: 10, enabled: true },
				sessionDuration: { weight: 3, maxScore: 10, enabled: true },
				failedLoginAttempts: { weight: 4, maxScore: 10, enabled: true },

				postingFrequency: { weight: 4, maxScore: 10, enabled: true },
				postingTimePattern: { weight: 4, maxScore: 10, enabled: true },
				contentDiversity: { weight: 4, maxScore: 10, enabled: true },
				mediaUsagePattern: { weight: 4, maxScore: 10, enabled: true },
				interactionPattern: { weight: 4, maxScore: 10, enabled: true },

				followRatio: { weight: 5, maxScore: 10, enabled: true },
				mutualFollowRate: { weight: 5, maxScore: 10, enabled: true },
				socialGraphDensity: { weight: 5, maxScore: 10, enabled: true },
				interactionReciprocity: { weight: 5, maxScore: 10, enabled: true },

				averageNoteLength: { weight: 3, maxScore: 10, enabled: true },
				hashtagUsage: { weight: 2, maxScore: 10, enabled: true },
				mentionFrequency: { weight: 3, maxScore: 10, enabled: true },
				urlUsage: { weight: 2, maxScore: 10, enabled: true },

				reportedCount: { weight: 5, maxScore: 10, enabled: true },
				blockedByCount: { weight: 5, maxScore: 10, enabled: true },

				rateLimitHits: { weight: 3, maxScore: 10, enabled: true },
				apiUsagePattern: { weight: 2, maxScore: 10, enabled: true },
			},
			totalScoreThresholds: {
				poor: 55,
				fair: 65,
				good: 76,
				veryGood: 87,
				excellent: 100,
			},
		};
	}

	@bindThis
	private async normalizeScore(rawScore: number, dimension: keyof RiskScoreConfig['dimensions'], userId: string): Promise<number> {
		const config = this.config?.dimensions[dimension];
		if (!config || !config.enabled) return 0;

		try {
			const populationContext = await this.dynamicScoringService.calculateDynamicScore(
				dimension.toString(),
				rawScore,
				userId
			);

			return populationContext.adjustedScore;
		} catch (error) {
			console.warn(`Dynamic scoring failed for ${dimension} (user ${userId}), using static normalization:`, error);
			return Math.min(config.maxScore, Math.max(0, rawScore * config.maxScore));
		}
	}

	@bindThis
	private calculateProfileCompleteScore(user: MiUser, profile: any): number {
		let score = 0;
		if (user.name) score += 0.25;
		if (profile.description) score += 0.25;
		if (profile.location) score += 0.25;
		if (profile.birthday) score += 0.25;
		return score;
	}

	@bindThis
	private async calculateLoginFrequencyScore(userId: string): Promise<number> {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const recentLogins = await this.signinsRepository.count({
			where: {
				userId,
				id: MoreThan(this.idService.gen(thirtyDaysAgo.getTime())),
			},
		});

		const avgPerDay = recentLogins / 30;

		if (avgPerDay >= 0.5 && avgPerDay <= 5) return await this.normalizeScore(1, 'loginFrequency', userId);
		if (avgPerDay > 10) return await this.normalizeScore(0.2, 'loginFrequency', userId);
		if (avgPerDay < 0.1) return await this.normalizeScore(0.3, 'loginFrequency', userId);
		return await this.normalizeScore(0.7, 'loginFrequency', userId);
	}

	@bindThis
	private async calculateLoginTimePatternScore(userId: string): Promise<number> {
		const logins = await this.signinsRepository.find({
			where: { userId },
			select: ['id'],
			take: 100,
			order: { id: 'DESC' },
		});

		if (logins.length < 5) return await this.normalizeScore(0.5, 'loginTimePattern', userId);

		const hours = logins.map(l => this.idService.parse(l.id).date.getHours());
		const uniqueHours = new Set(hours).size;

		if (uniqueHours < 3) return await this.normalizeScore(0.2, 'loginTimePattern', userId);
		if (uniqueHours < 6) return await this.normalizeScore(0.4, 'loginTimePattern', userId);
		if (uniqueHours < 12) return await this.normalizeScore(0.6, 'loginTimePattern', userId);
		if (uniqueHours < 18) return await this.normalizeScore(0.8, 'loginTimePattern', userId);
		return await this.normalizeScore(1, 'loginTimePattern', userId);
	}

	@bindThis
	private async calculateIpChangeFrequencyScore(userId: string): Promise<number> {
		const sessions = await this.userSessionsRepository.find({
			where: { userId, isActive: true },
			select: ['ip', 'lastUsedAt'],
		});

		if (sessions.length === 0) return 0.5;

		const allIps = new Set<string>();
		let totalChanges = 0;

		for (const session of sessions) {
			if (session.ip && Array.isArray(session.ip)) {
				for (const ipInfo of session.ip) {
					allIps.add(ipInfo.address);
					totalChanges += ipInfo.count;
				}
			}
		}

		if (allIps.size === 0) return 0.5;

		const changeRate = allIps.size / Math.max(1, totalChanges);

		let ipRiskFactor = 1;
		try {
			for (const ip of Array.from(allIps).slice(0, 5)) {
				const proxyInfo = await this.ip2LocationService.checkIPProxy(ip);
				if (proxyInfo && proxyInfo.fraudScore) {
					const fraudScore = parseInt(proxyInfo.fraudScore, 10);
					if (fraudScore > 50) {
						ipRiskFactor *= 0.8;
					}
					if (proxyInfo.isProxy === 1 || proxyInfo.proxyType === 'TOR') {
						ipRiskFactor *= 0.7;
					}
				}
			}
		} catch (e) {
		}

		let rawScore: number;
		if (changeRate > 0.9) {
			rawScore = 0.2;
		} else if (changeRate > 0.5) {
			rawScore = 0.6;
		} else if (changeRate > 0.2) {
			rawScore = 0.8;
		} else if (changeRate < 0.05) {
			rawScore = 0.9;
		} else {
			rawScore = 1;
		}

		rawScore *= ipRiskFactor;

		return await this.normalizeScore(rawScore, 'ipChangeFrequency', userId);
	}

	@bindThis
	private async calculateDeviceDiversityScore(userId: string): Promise<number> {
		const sessions = await this.userSessionsRepository.find({
			where: { userId },
			select: ['deviceId', 'createdAt', 'lastUsedAt'],
			take: 100,
		});

		if (sessions.length === 0) return 0.5;

		const devices = new Set(sessions.map(s => s.deviceId).filter(d => d));

		const deviceCount = devices.size;

		if (deviceCount === 1) return await this.normalizeScore(0.8, 'deviceDiversity', userId);
		if (deviceCount <= 3) return await this.normalizeScore(1, 'deviceDiversity', userId);
		if (deviceCount <= 5) return await this.normalizeScore(0.7, 'deviceDiversity', userId);
		if (deviceCount > 10) return await this.normalizeScore(0.3, 'deviceDiversity', userId);
		return await this.normalizeScore(0.5, 'deviceDiversity', userId);
	}

	@bindThis
	private async calculateSessionDurationScore(userId: string): Promise<number> {
		const sessions = await this.userSessionsRepository.find({
			where: { userId },
			select: ['createdAt', 'lastUsedAt', 'expiresAt', 'isActive'],
			take: 50,
			order: { lastUsedAt: 'DESC' },
		});

		if (sessions.length === 0) return 0.5;

		const durations = sessions.map(s => {
			const created = s.createdAt.getTime();
			const lastUsed = s.lastUsedAt.getTime();
			return (lastUsed - created) / (1000 * 60);
		}).filter(d => d > 0);

		if (durations.length === 0) return 0.5;

		const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
		const stats = await this.getPopulationStats('session_duration');

		return this.calculateDynamicScore(avgDuration, stats.mean, stats.stdDev, true);
	}

	@bindThis
	private async calculateFailedLoginAttemptsScore(userId: string): Promise<number> {
		const failedAttempts = await this.redisClient.get(`failed-login:${userId}`);

		if (!failedAttempts) return await this.normalizeScore(1, 'failedLoginAttempts', userId);

		const count = parseInt(failedAttempts, 10);

		if (count === 0) return await this.normalizeScore(1, 'failedLoginAttempts', userId);
		if (count <= 3) return await this.normalizeScore(0.8, 'failedLoginAttempts', userId);
		if (count <= 5) return await this.normalizeScore(0.6, 'failedLoginAttempts', userId);
		if (count <= 10) return await this.normalizeScore(0.3, 'failedLoginAttempts', userId);
		return await this.normalizeScore(0.1, 'failedLoginAttempts', userId);
	}

	@bindThis
	private async calculatePostingFrequencyScore(userId: string): Promise<number> {
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const recentNotes = await this.notesRepository.count({
			where: {
				userId,
				id: MoreThan(this.idService.gen(sevenDaysAgo.getTime())),
			},
		});

		const avgPerDay = recentNotes / 7;

		let rawScore: number;
		if (avgPerDay > 100) {
			rawScore = 0;
		} else if (avgPerDay > 50) {
			rawScore = 0.2;
		} else if (avgPerDay >= 1 && avgPerDay <= 10) {
			rawScore = 1;
		} else if (avgPerDay < 0.1) {
			rawScore = 0.3;
		} else {
			rawScore = 0.7;
		}

		return await this.normalizeScore(rawScore, 'postingFrequency', userId);
	}

	@bindThis
	private async calculatePostingTimePatternScore(userId: string): Promise<number> {
		const notes = await this.notesRepository.find({
			where: { userId },
			select: ['id'],
			take: 100,
			order: { id: 'DESC' },
		});

		if (notes.length < 10) return await this.normalizeScore(0.5, 'postingTimePattern', userId);

		const hours = notes.map(n => this.idService.parse(n.id).date.getHours());
		const uniqueHours = new Set(hours).size;

		let rawScore: number;
		if (uniqueHours < 3) {
			rawScore = 0.2;
		} else if (uniqueHours < 6) {
			rawScore = 0.4;
		} else if (uniqueHours < 12) {
			rawScore = 0.6;
		} else if (uniqueHours < 18) {
			rawScore = 0.8;
		} else {
			rawScore = 1;
		}

		return await this.normalizeScore(rawScore, 'postingTimePattern', userId);
	}

	@bindThis
	private async calculateContentDiversityScore(userId: string): Promise<number> {
		const notes = await this.notesRepository.find({
			where: { userId },
			select: ['text'],
			take: 50,
			order: { id: 'DESC' },
		});

		if (notes.length < 5) return 2;

		const texts = notes.filter(n => n.text).map(n => n.text!);
		const uniqueTexts = new Set(texts).size;
		const diversityRatio = uniqueTexts / texts.length;

		const stats = await this.getPopulationStats('content_diversity');

		return this.calculateDynamicScore(diversityRatio, stats.mean, stats.stdDev, true);
	}

	@bindThis
	private async calculateMediaUsageScore(userId: string): Promise<number> {
		const notesWithMedia = await this.notesRepository.count({
			where: {
				userId,
				fileIds: Not('{}'),
			},
		});

		const totalNotes = await this.notesRepository.count({ where: { userId } });

		if (totalNotes === 0) return 2;

		const mediaRatio = notesWithMedia / totalNotes;

		const stats = await this.getPopulationStats('media_ratio');

		const deviation = Math.abs(mediaRatio - stats.mean);
		const normalizedDeviation = deviation / Math.max(0.01, stats.stdDev);

		return Math.exp(-normalizedDeviation * normalizedDeviation / 2);
	}

	@bindThis
	private async calculateInteractionPatternScore(userId: string): Promise<number> {
		const [replies, renotes] = await Promise.all([
			this.notesRepository.count({
				where: {
					userId,
					replyId: Not(IsNull()),
				},
			}),
			this.notesRepository.count({
				where: {
					userId,
					renoteId: Not(IsNull()),
				},
			}),
		]);

		const totalNotes = await this.notesRepository.count({ where: { userId } });

		if (totalNotes === 0) return 2;

		const interactionRatio = (replies + renotes) / totalNotes;

		if (interactionRatio > 0.2 && interactionRatio < 0.7) return 5;
		if (interactionRatio > 0.1 && interactionRatio < 0.8) return 4;
		if (interactionRatio > 0.9) return 2;
		return 3;
	}

	@bindThis
	private async calculateFollowRatioScore(user: MiUser): Promise<number> {
		if (user.followersCount === 0) return 2;

		const ratio = user.followingCount / user.followersCount;

		const stats = await this.getPopulationStats('follow_ratio');

		const logRatio = Math.log(ratio + 1);
		const logMean = Math.log(stats.mean + 1);
		const logStdDev = stats.stdDev / (stats.mean + 1);

		const deviation = Math.abs(logRatio - logMean);
		const normalizedDeviation = deviation / Math.max(0.01, logStdDev);

		return Math.exp(-normalizedDeviation * normalizedDeviation / 2);
	}

	@bindThis
	private async calculateMutualFollowScore(userId: string): Promise<number> {
		const [following, followers] = await Promise.all([
			this.followingsRepository.find({
				where: { followerId: userId },
				select: ['followeeId'],
			}),
			this.followingsRepository.find({
				where: { followeeId: userId },
				select: ['followerId'],
			}),
		]);

		if (following.length === 0) return 2;

		const followingIds = new Set(following.map(f => f.followeeId));
		const followerIds = new Set(followers.map(f => f.followerId));

		let mutualCount = 0;
		for (const id of followingIds) {
			if (followerIds.has(id)) mutualCount++;
		}

		const mutualRate = mutualCount / following.length;

		if (mutualRate > 0.7) return 5;
		if (mutualRate > 0.5) return 4;
		if (mutualRate > 0.3) return 3;
		if (mutualRate > 0.1) return 2;
		return 1;
	}

	@bindThis
	private async calculateSocialGraphDensityScore(userId: string): Promise<number> {
		const following = await this.followingsRepository.find({
			where: { followerId: userId },
			select: ['followeeId'],
			take: 100,
		});

		if (following.length < 10) return 2;

		const followeeIds = following.map(f => f.followeeId);
		const interconnections = await this.followingsRepository.count({
			where: {
				followerId: In(followeeIds),
				followeeId: In(followeeIds),
			},
		});

		const possibleConnections = followeeIds.length * (followeeIds.length - 1);
		const density = interconnections / possibleConnections;

		if (density > 0.3) return 5;
		if (density > 0.2) return 4;
		if (density > 0.1) return 3;
		if (density > 0.05) return 2;
		return 1;
	}

	@bindThis
	private async calculateInteractionReciprocityScore(userId: string): Promise<number> {
		const sentReplies = await this.notesRepository.find({
			where: {
				userId,
				replyId: Not(IsNull()),
			},
			select: ['replyUserId'],
			take: 100,
		});

		const receivedReplies = await this.notesRepository.find({
			where: {
				replyUserId: userId,
			},
			select: ['userId'],
			take: 100,
		});

		if (sentReplies.length === 0) return 2;

		const sentToUsers = new Set(sentReplies.map(r => r.replyUserId).filter(Boolean));
		const receivedFromUsers = new Set(receivedReplies.map(r => r.userId));

		let reciprocalCount = 0;
		for (const uid of sentToUsers) {
			if (uid && receivedFromUsers.has(uid)) reciprocalCount++;
		}

		const reciprocity = reciprocalCount / sentToUsers.size;

		if (reciprocity > 0.5) return 5;
		if (reciprocity > 0.3) return 4;
		if (reciprocity > 0.2) return 3;
		if (reciprocity > 0.1) return 2;
		return 1;
	}

	@bindThis
	private async calculateAverageNoteLengthScore(userId: string): Promise<number> {
		const notes = await this.notesRepository.find({
			where: { userId },
			select: ['text'],
			take: 50,
			order: { id: 'DESC' },
		});

		if (notes.length === 0) return 2;

		const lengths = notes.filter(n => n.text).map(n => n.text!.length);
		const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

		if (avgLength > 50 && avgLength < 500) return 5;
		if (avgLength > 20 && avgLength < 1000) return 4;
		if (avgLength < 10) return 1;
		if (avgLength > 2000) return 2;
		return 3;
	}

	@bindThis
	private async calculateHashtagUsageScore(userId: string): Promise<number> {
		const notesWithTags = await this.notesRepository.count({
			where: {
				userId,
				tags: Not('{}'),
			},
		});

		const totalNotes = await this.notesRepository.count({ where: { userId } });

		if (totalNotes === 0) return 1;

		const tagRatio = notesWithTags / totalNotes;

		if (tagRatio > 0.1 && tagRatio < 0.5) return 3;
		if (tagRatio > 0.8) return 1;
		return 2;
	}

	@bindThis
	private async calculateMentionFrequencyScore(userId: string): Promise<number> {
		const notesWithMentions = await this.notesRepository.count({
			where: {
				userId,
				mentions: Not('{}'),
			},
		});

		const totalNotes = await this.notesRepository.count({ where: { userId } });

		if (totalNotes === 0) return 2;

		const mentionRatio = notesWithMentions / totalNotes;

		if (mentionRatio > 0.1 && mentionRatio < 0.4) return 4;
		if (mentionRatio > 0.7) return 1;
		return 2;
	}

	@bindThis
	private async calculateUrlUsageScore(userId: string): Promise<number> {
		const notes = await this.notesRepository.find({
			where: { userId },
			select: ['text'],
			take: 50,
			order: { id: 'DESC' },
		});

		const urlPattern = /https?:\/\/\S+/g;
		let urlCount = 0;
		let noteWithUrlCount = 0;

		for (const note of notes) {
			if (note.text) {
				const urls = note.text.match(urlPattern);
				if (urls) {
					urlCount += urls.length;
					noteWithUrlCount++;
				}
			}
		}

		if (notes.length === 0) return 2;

		const urlRatio = noteWithUrlCount / notes.length;

		if (urlRatio > 0.1 && urlRatio < 0.4) return 3;
		if (urlRatio > 0.7) return 1;
		return 2;
	}

	@bindThis
	private async calculateReportedScore(userId: string): Promise<number> {
		const reports = await this.abuseUserReportsRepository.find({
			where: { targetUserId: userId },
		});

		if (reports.length === 0) return 1;

		const now = Date.now();
		let weightedScore = 0;
		let totalWeight = 0;

		for (const report of reports) {
			const reportAge = now - this.idService.parse(report.id).date.getTime();
			const ageDays = reportAge / (1000 * 60 * 60 * 24);
			const ageWeight = Math.exp(-ageDays / 30);

			if (!report.resolved) {
				weightedScore += ageWeight * 0.3;
			} else if (report.resolvedAs === 'accept') {
				weightedScore += ageWeight * 0.7;
			} else if (report.resolvedAs === 'reject') {
				weightedScore -= ageWeight * 0.2;
			}
			totalWeight += ageWeight;
		}

		if (totalWeight === 0) return 1;

		const normalizedImpact = weightedScore / totalWeight;
		return Math.max(0, Math.min(1, 1 - normalizedImpact));
	}

	@bindThis
	private async calculateBlockedScore(userId: string): Promise<number> {
		const blockedCount = await this.mutingsRepository.count({
			where: { muteeId: userId },
		});

		return Math.exp(-blockedCount / 10);
	}

	@bindThis
	private async calculateRateLimitScore(userId: string): Promise<number> {
		const key = `rate-limit:${userId}:*`;
		const keys = await this.redisClient.keys(key);

		const hitCount = keys.length;

		if (hitCount === 0) return 5;
		if (hitCount <= 5) return 4;
		if (hitCount <= 10) return 3;
		if (hitCount <= 20) return 2;
		if (hitCount <= 50) return 1;
		return 0;
	}

	@bindThis
	private async calculateApiUsagePatternScore(userId: string): Promise<number> {
		const recentApiCalls = await this.redisClient.get(`api-calls:${userId}:pattern`);

		if (!recentApiCalls) return 3;

		const pattern = JSON.parse(recentApiCalls);

		if (pattern.burstCount > 100) return 0;
		if (pattern.regularInterval) return 1;

		return 3;
	}

	@bindThis
	private async applyScoreAdjustmentDynamics(baseScore: number, adjustmentFactor: number): Promise<number> {
		const adjustment = adjustmentFactor - 1;

		const k = 0.1;
		const midpoint = 65;

		const sigmoid = (x: number) => 1 / (1 + Math.exp(-k * (x - midpoint)));
		const sigmoidDerivative = (x: number) => {
			const s = sigmoid(x);
			return k * s * (1 - s);
		};

		let dynamicMultiplier: number;

		if (adjustment > 0) {
			const percentile = this.calculatePercentile(baseScore);
			dynamicMultiplier = Math.log(101 - percentile) / Math.log(101);
		} else {
			const shape = 2;
			const scale = 65;
			dynamicMultiplier = Math.pow(baseScore / scale, shape - 1);
		}

		const priorWeight = 0.7;
		const likelihoodWeight = 0.3;

		const adjustedScore = baseScore * (1 + adjustment * dynamicMultiplier * sigmoidDerivative(baseScore));
		const finalScore = priorWeight * baseScore + likelihoodWeight * adjustedScore;

		if (finalScore < 5) {
			return 5 * Math.tanh(finalScore / 5);
		} else if (finalScore > 95) {
			return 100 - 5 * Math.tanh((100 - finalScore) / 5);
		}

		return finalScore;
	}

	@bindThis
	private calculatePercentile(score: number): number {
		const distributionData = this.baselines.get('scoreDistribution');
		const distribution = Array.isArray(distributionData) ? distributionData : [];
		if (distribution.length === 0) return 60;

		const below = distribution.filter(s => s < score).length;
		return (below / distribution.length) * 100;
	}

	@bindThis
	private async calculateTotalScore(dimensions: RiskScoreDimensions): Promise<number> {
		if (!this.config) return 60;

		let totalScore = 0;
		let totalWeight = 0;

		for (const [key, value] of Object.entries(dimensions)) {
			const dimensionKey = key as keyof RiskScoreConfig['dimensions'];
			const config = this.config.dimensions[dimensionKey];
			if (config && config.enabled) {
				const normalizedValue = Math.min(config.maxScore, Math.max(0, value));
				totalScore += normalizedValue * config.weight;
				totalWeight += config.maxScore * config.weight;
			}
		}

		if (totalWeight === 0) return 60;

		let finalScore = (totalScore / totalWeight) * 100;

		const outlierPenalty = this.calculateOutlierPenalty(dimensions);
		finalScore *= (1 - outlierPenalty);

		return Math.min(95, Math.max(5, finalScore));
	}

	@bindThis
	private calculateOutlierPenalty(dimensions: RiskScoreDimensions): number {
		const values = Object.values(dimensions);
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
		const stdDev = Math.sqrt(variance);

		if (stdDev === 0) return 0;

		let outlierCount = 0;
		for (const value of values) {
			const zScore = Math.abs((value - mean) / stdDev);
			if (zScore > 2.5) {
				outlierCount++;
			}
		}

		return Math.min(0.2, outlierCount * 0.05);
	}

	@bindThis
	private async determineRiskLevel(score: number): Promise<'poor' | 'fair' | 'good' | 'veryGood' | 'excellent'> {
		if (!this.config) {
			if (score >= 87) return 'excellent';
			if (score >= 76) return 'veryGood';
			if (score >= 65) return 'good';
			if (score >= 55) return 'fair';
			return 'poor';
		}

		const thresholds = this.config.totalScoreThresholds;
		if (score >= thresholds.excellent) return 'excellent';
		if (score >= thresholds.veryGood) return 'veryGood';
		if (score >= thresholds.good) return 'good';
		if (score >= thresholds.fair) return 'fair';
		return 'poor';
	}

	@bindThis
	public async updateConfig(newConfig: Partial<RiskScoreConfig>): Promise<void> {
		const currentConfig = this.config || await this.getDefaultConfig();
		this.config = { ...currentConfig, ...newConfig };
		await this.redisClient.set('risk-score:config', JSON.stringify(this.config), 'EX', 3600);
	}

	@bindThis
	private generateDetails(dimensions: RiskScoreDimensions, _totalScore: number): {
		strengths: string[];
		concerns: string[];
		recommendations: string[];
	} {
		const strengths: string[] = [];
		const concerns: string[] = [];
		const recommendations: string[] = [];

		if (dimensions.accountAge >= 4) strengths.push('Mature account age');
		if (dimensions.emailVerified === 5) strengths.push('Verified email');
		if (dimensions.twoFactorEnabled === 3) strengths.push('Two-factor authentication enabled');
		if (dimensions.mutualFollowRate >= 4) strengths.push('Good mutual follow rate');
		if (dimensions.reportedCount === 5) strengths.push('No report records');

		if (dimensions.accountAge <= 1) concerns.push('Newly registered account');
		if (dimensions.emailVerified === 0) concerns.push('Unverified email');
		if (dimensions.postingFrequency <= 1) concerns.push('Abnormal posting frequency');
		if (dimensions.contentDiversity <= 1) concerns.push('High content repetition');
		if (dimensions.followRatio <= 1) concerns.push('Abnormal follow ratio');
		if (dimensions.rateLimitHits <= 1) concerns.push('Frequent rate limit hits');

		if (dimensions.emailVerified === 0) recommendations.push('Recommend verifying email address');
		if (dimensions.twoFactorEnabled === 0) recommendations.push('Recommend enabling two-factor authentication');
		if (dimensions.avatarExists === 0) recommendations.push('Recommend setting avatar');
		if (dimensions.profileComplete <= 2) recommendations.push('Recommend completing profile');
		if (dimensions.contentDiversity <= 2) recommendations.push('Recommend posting more diverse content');

		return { strengths, concerns, recommendations };
	}

	@bindThis
	public async getCachedScore(userId: string): Promise<UserRiskScore | null> {
		const cached = await this.redisClient.get(`user:risk-score:${userId}`);
		if (cached) {
			return JSON.parse(cached);
		}
		return null;
	}

	@bindThis
	public async batchCalculateScores(userIds: string[]): Promise<Map<string, UserRiskScore>> {
		const results = new Map<string, UserRiskScore>();

		const batchSize = 10;
		for (let i = 0; i < userIds.length; i += batchSize) {
			const batch = userIds.slice(i, i + batchSize);
			const promises = batch.map(userId => this.calculateUserRiskScore(userId));
			const batchResults = await Promise.all(promises);

			batchResults.forEach((result, index) => {
				results.set(batch[index], result);
			});
		}

		return results;
	}

	@bindThis
	private async getPopulationStats(metric: string): Promise<{ mean: number; stdDev: number; median: number }> {
		const cached = await this.redisClient.get(`stats:${metric}`);
		if (cached) {
			return JSON.parse(cached);
		}

		const defaults: Record<string, { mean: number; stdDev: number; median: number }> = {
			account_age: { mean: 180, stdDev: 365, median: 90 },
			posting_frequency: { mean: 2, stdDev: 5, median: 1 },
			content_diversity: { mean: 0.7, stdDev: 0.2, median: 0.75 },
			media_ratio: { mean: 0.3, stdDev: 0.25, median: 0.25 },
			follow_ratio: { mean: 1, stdDev: 2, median: 0.8 },
			mutual_rate: { mean: 0.4, stdDev: 0.3, median: 0.35 },
		};

		const stats = defaults[metric] || { mean: 0.5, stdDev: 0.25, median: 0.5 };

		await this.redisClient.set(`stats:${metric}`, JSON.stringify(stats), 'EX', 3600);
		return stats;
	}

	@bindThis
	private calculateDynamicScore(value: number, mean: number, stdDev: number, optimal: boolean = true): number {
		const zScore = (value - mean) / Math.max(0.01, stdDev);

		if (optimal) {
			return 1 / (1 + Math.exp(-zScore / 2));
		} else {
			return 1 / (1 + Math.exp(zScore / 2));
		}
	}

	@bindThis
	public async handleReportChange(targetUserId: string, reportAction: null | 'accepted' | 'rejected'): Promise<void> {
		const newScore = await this.calculateUserRiskScore(targetUserId);

		await this.riskEventLogService.logRiskEvent({
			userId: targetUserId,
			eventType: 'risk_level_changed',
			riskScore: newScore.totalScore,
			riskLevel: newScore.riskLevel,
			details: {
				trigger: 'report_status_change',
				reportAction: reportAction,
				dimensions: newScore.dimensions,
			},
			timestamp: new Date(),
		});

		await this.usersRepository.update(targetUserId, {
			riskScore: newScore.totalScore,
			riskLevel: newScore.riskLevel,
			riskScoreUpdatedAt: new Date(),
		});

		await this.redisClient.set(
			`user:risk-score:${targetUserId}`,
			JSON.stringify(newScore),
			'EX',
			60 * 60 * 24,
		);
	}

	@bindThis
	public async forceSyncAllScores(): Promise<void> {
		console.log('Starting forced sync of all cached scores to database...');

		try {
			const keys = await this.redisClient.keys('user:risk-score:*');

			if (keys.length === 0) {
				console.log('No cached scores to sync');
				return;
			}

			console.log(`Found ${keys.length} cached scores to sync`);

			const batchSize = 50;
			let syncedCount = 0;

			for (let i = 0; i < keys.length; i += batchSize) {
				const batch = keys.slice(i, i + batchSize);
				const promises = batch.map(async (key) => {
					try {
						const cached = await this.redisClient.get(key);
						if (!cached) return;

						const score: UserRiskScore = JSON.parse(cached);

						await this.usersRepository.update(score.userId, {
							riskScore: score.totalScore,
							riskLevel: score.riskLevel,
							riskScoreUpdatedAt: new Date(),
						});

						syncedCount++;
					} catch (error) {
						console.error(`Failed to sync score for key ${key}:`, error);
					}
				});

				await Promise.all(promises);
				console.log(`Synced batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(keys.length / batchSize)}`);
			}

			console.log(`Forced sync completed: ${syncedCount}/${keys.length} scores synced`);
		} catch (error) {
			console.error('Error during forced sync:', error);
		}
	}

	@bindThis
	private async saveHistoricalData(userId: string, totalScore: number, dimensions: RiskScoreDimensions): Promise<void> {
		try {
			const timestamp = new Date().toISOString();

			const scoreHistoryKey = `user:score:history:${userId}`;
			await this.redisClient.lpush(scoreHistoryKey, totalScore.toString());
			await this.redisClient.ltrim(scoreHistoryKey, 0, 99);
			await this.redisClient.expire(scoreHistoryKey, 365 * 24 * 60 * 60);

			const dimensionsHistoryKey = `user:dimensions:history:${userId}`;
			await this.redisClient.lpush(dimensionsHistoryKey, JSON.stringify(dimensions));
			await this.redisClient.ltrim(dimensionsHistoryKey, 0, 99);
			await this.redisClient.expire(dimensionsHistoryKey, 365 * 24 * 60 * 60);

			const behaviorSnapshot = {
				userId,
				timestamp: new Date(),
				metrics: {
					activity: dimensions.postingFrequency,
					followingCount: dimensions.followRatio * 100,
					contentType: dimensions.contentDiversity,
					postingFrequency: dimensions.postingFrequency,
					followRatio: dimensions.followRatio,
					interactionRate: dimensions.interactionPattern,
					contentDiversity: dimensions.contentDiversity,
				},
				hash: this.generateBehaviorHash(dimensions),
			};

			const behaviorHistoryKey = `user:behavior:history:${userId}`;
			await this.redisClient.lpush(behaviorHistoryKey, JSON.stringify(behaviorSnapshot));
			await this.redisClient.ltrim(behaviorHistoryKey, 0, 99);
			await this.redisClient.expire(behaviorHistoryKey, 90 * 24 * 60 * 60);
		} catch (error) {
			console.error('Failed to save historical data:', error);
		}
	}

	@bindThis
	private generateBehaviorHash(dimensions: RiskScoreDimensions): string {
		const hashString = [
			Math.floor(dimensions.postingFrequency * 100),
			Math.floor(dimensions.followRatio * 100),
			Math.floor(dimensions.contentDiversity * 100),
			Math.floor(dimensions.interactionPattern * 100),
		].join('-');

		return createHash('md5').update(hashString).digest('hex').substring(0, 8);
	}

	@bindThis
	public async onApplicationShutdown(): Promise<void> {
		console.log('Application shutdown detected, syncing risk scores...');
		await this.forceSyncAllScores();
		console.log('Risk score sync completed');
	}
}
