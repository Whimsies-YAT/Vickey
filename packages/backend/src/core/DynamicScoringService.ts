/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type { UsersRepository } from '@/models/_.js';
import { IsNull, MoreThan } from "typeorm";
import { IdService } from '@/core/IdService.js';
import { RedisKVCache } from '@/misc/cache.js';

export interface DynamicScoreContext {
	userPopulation: {
		total: number;
		active: number;
		percentiles: Record<string, number[]>;
		distributions: Record<string, Distribution>;
	};

	systemState: {
		attackLevel: number;
		spamLevel: number;
		overallHealth: number;
	};

	temporalFactors: {
		timeOfDay: number;
		dayOfWeek: number;
		seasonality: number;
		trend: number;
	};

	relativePosition: {
		percentile: number;
		zScore: number;
		deviation: number;
	};
}

export interface Distribution {
	mean: number;
	median: number;
	std: number;
	min: number;
	max: number;
	q1: number;
	q3: number;
	iqr: number;
	skewness: number;
	kurtosis: number;
}

export interface DynamicScore {
	rawValue: number;
	normalizedValue: number;
	percentileRank: number;
	adjustedScore: number;
	confidence: number;
	adjustmentFactors: {
		populationFactor: number;
		contextFactor: number;
		temporalFactor: number;
		relativeFactor: number;
	};
}

@Injectable()
export class DynamicScoringService {
	private readonly UPDATE_INTERVAL = 3600000;
	private distributionCache: RedisKVCache<Distribution>;
	private sampleDataCache: RedisKVCache<number[]>;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
	) {
		this.distributionCache = new RedisKVCache<Distribution>(this.redisClient, 'distributions', {
			lifetime: this.UPDATE_INTERVAL,
			memoryCacheLifetime: 1000 * 60 * 5,
			fetcher: (dimension) => this.calculateDistribution(dimension),
			toRedisConverter: (value) => JSON.stringify(value),
			fromRedisConverter: (value) => JSON.parse(value),
		});

		this.sampleDataCache = new RedisKVCache<number[]>(this.redisClient, 'sampleData', {
			lifetime: this.UPDATE_INTERVAL,
			memoryCacheLifetime: 1000 * 60 * 10,
			fetcher: (dimension) => this.collectSampleFromDatabase(dimension),
			toRedisConverter: (value) => JSON.stringify(value),
			fromRedisConverter: (value) => JSON.parse(value),
		});

		this.initializeService().catch(err => {
			console.error('Failed to initialize DynamicScoringService:', err);
		});

		setInterval(() => this.updateDistributions(), this.UPDATE_INTERVAL);
		setInterval(() => this.updateTrendAnalysis(), this.UPDATE_INTERVAL);
	}

	@bindThis
	private async initializeService(): Promise<void> {
		try {
			const keyDimensions = [
				'accountAge', 'postingFrequency', 'followRatio',
				'contentDiversity', 'interactionRate', 'loginFrequency',
			];

			await this.redisClient.set('system:attack-level', '0', 'EX', 86400);
			await this.redisClient.set('system:spam-level', '0', 'EX', 86400);
			await this.redisClient.set('system:health', '1', 'EX', 86400);

			for (const dimension of keyDimensions) {
				await this.getDistribution(dimension);
			}

			await this.updateTrendAnalysis();
		} catch (error) {
			console.error('Failed to initialize DynamicScoringService:', error);
		}
	}

	@bindThis
	public async calculateDynamicScore(
		dimension: string,
		rawValue: number,
		userId: string,
		context?: Partial<DynamicScoreContext>
	): Promise<DynamicScore> {
		const distribution = await this.getDistribution(dimension);
		const fullContext = await this.getFullContext(userId, dimension, context);
		const normalizedValue = this.normalize(rawValue, distribution);
		const percentileRank = await this.calculatePercentileRank(dimension, rawValue);

		const adjustmentFactors = {
			populationFactor: this.calculatePopulationFactor(distribution, fullContext),
			contextFactor: this.calculateContextFactor(fullContext),
			temporalFactor: this.calculateTemporalFactor(fullContext),
			relativeFactor: this.calculateRelativeFactor(normalizedValue, percentileRank),
		};

		const adjustedScore = this.applyDynamicAdjustment(
			normalizedValue,
			adjustmentFactors,
			fullContext
		);

		const confidence = this.calculateConfidence(distribution, fullContext);

		return {
			rawValue,
			normalizedValue,
			percentileRank,
			adjustedScore,
			confidence,
			adjustmentFactors,
		};
	}

	@bindThis
	public async batchCalculateDynamicScores(
		dimensions: Record<string, number>,
		userId: string
	): Promise<Record<string, DynamicScore>> {
		const context = await this.getFullContext(userId, 'all');
		const results: Record<string, DynamicScore> = {};

		const promises = Object.entries(dimensions).map(async ([dim, value]) => {
			const score = await this.calculateDynamicScore(dim, value, userId, context);
			return { dim, score };
		});

		const scores = await Promise.all(promises);
		scores.forEach(({ dim, score }) => {
			results[dim] = score;
		});

		return results;
	}

	@bindThis
	private async getDistribution(dimension: string): Promise<Distribution> {
		try {
			return await this.distributionCache.fetch(dimension);
		} catch (error) {
			console.warn(`Failed to fetch distribution for ${dimension}, using default:`, error);
			return this.getDefaultDistribution();
		}
	}

	private async calculateDistribution(dimension: string): Promise<Distribution> {
		const sampleSize = 1000;
		const values = await this.collectSampleFromDatabase(dimension);

		if (values.length < 10) {
			return this.getDefaultDistribution();
		}

		values.sort((a, b) => a - b);

		const mean = this.mean(values);
		const median = this.median(values);
		const std = this.standardDeviation(values);
		const min = values[0];
		const max = values[values.length - 1];
		const q1 = this.percentile(values, 25);
		const q3 = this.percentile(values, 75);
		const iqr = q3 - q1;
		const skewness = this.calculateSkewness(values, mean, std);
		const kurtosis = this.calculateKurtosis(values, mean, std);

		return {
			mean, median, std, min, max, q1, q3, iqr, skewness, kurtosis
		};
	}

	@bindThis
	private normalize(value: number, distribution: Distribution): number {
		if (Math.abs(distribution.skewness) > 1) {
			if (value > 0) {
				value = Math.log1p(value);
				distribution = {
					...distribution,
					mean: Math.log1p(distribution.mean),
					std: Math.log1p(distribution.std),
				};
			}
		}

		if (distribution.iqr > 0) {
			return (value - distribution.median) / distribution.iqr;
		}

		if (distribution.std > 0) {
			return (value - distribution.mean) / distribution.std;
		}

		return 0.5;
	}

	@bindThis
	private async calculatePercentileRank(
		dimension: string,
		value: number
	): Promise<number> {
		const key = `rank:${dimension}`;
		const rank = await this.redisClient.zrevrank(key, value.toString());
		const total = await this.redisClient.zcard(key);

		if (rank === null || total === 0) {
			const distribution = await this.getDistribution(dimension);
			return this.estimatePercentileFromDistribution(value, distribution);
		}

		return ((total - rank) / total) * 100;
	}

	@bindThis
	private estimatePercentileFromDistribution(
		value: number,
		distribution: Distribution
	): number {
		if (distribution.std === 0) return 50;

		const z = (value - distribution.mean) / distribution.std;
		const cdf = 0.5 * (1 + this.erf(z / Math.sqrt(2)));

		return cdf * 100;
	}

	@bindThis
	private calculatePopulationFactor(
		distribution: Distribution,
		context: DynamicScoreContext
	): number {
		const population = context.userPopulation.total;
		let factor = 1;

		if (population < 100) {
			factor = 0.7;
		} else if (population < 1000) {
			factor = 0.85;
		} else if (population < 10000) {
			factor = 0.95;
		}

		if (distribution.std / distribution.mean > 2) {
			factor *= 0.8;
		}

		return factor;
	}

	@bindThis
	private calculateContextFactor(context: DynamicScoreContext): number {
		const { systemState } = context;
		let factor = 1;

		if (systemState.attackLevel > 0.7) {
			factor *= 0.7;
		} else if (systemState.attackLevel > 0.4) {
			factor *= 0.85;
		}

		if (systemState.spamLevel > 0.6) {
			factor *= 0.8;
		}

		if (systemState.overallHealth < 0.3) {
			factor *= 1.2;
		}

		return factor;
	}

	@bindThis
	private calculateTemporalFactor(context: DynamicScoreContext): number {
		const { temporalFactors } = context;

		const factor = (
			temporalFactors.timeOfDay * 0.2 +
			temporalFactors.dayOfWeek * 0.2 +
			temporalFactors.seasonality * 0.3 +
			temporalFactors.trend * 0.3
		);

		return 0.8 + factor * 0.4;
	}

	@bindThis
	private calculateRelativeFactor(
		_normalizedValue: number,
		percentileRank: number
	): number {
		if (percentileRank < 5 || percentileRank > 95) {
			return 0.7;
		}

		if (percentileRank < 20 || percentileRank > 80) {
			return 0.85;
		}

		return 1;
	}

	@bindThis
	private applyDynamicAdjustment(
		normalizedValue: number,
		factors: Record<string, number>,
		context: DynamicScoreContext
	): number {
		let score = (normalizedValue + 3) / 6 * 10;
		score = Math.max(0, Math.min(10, score));

		for (const factor of Object.values(factors)) {
			score *= factor;
		}

		const { relativePosition } = context;
		if (relativePosition.percentile < 10) {
			score *= 0.9;
		} else if (relativePosition.percentile > 90) {
			score *= 1.1;
		}

		return Math.max(0, Math.min(10, score));
	}

	@bindThis
	private calculateConfidence(
		distribution: Distribution,
		context: DynamicScoreContext
	): number {
		let confidence = 1;

		const sampleSize = context.userPopulation.active;
		if (sampleSize < 30) {
			confidence *= 0.5;
		} else if (sampleSize < 100) {
			confidence *= 0.7;
		} else if (sampleSize < 1000) {
			confidence *= 0.9;
		}

		const cv = distribution.std / (distribution.mean || 1);
		if (cv > 1) {
			confidence *= 0.8;
		}

		if (Math.abs(distribution.skewness) > 2) {
			confidence *= 0.85;
		}

		return Math.max(0.1, Math.min(1, confidence));
	}

	@bindThis
	private async getFullContext(
		userId: string,
		dimension: string,
		partialContext?: Partial<DynamicScoreContext>
	): Promise<DynamicScoreContext> {
		const userPopulation = await this.getUserPopulationStats();
		const systemState = await this.getSystemState();
		const temporalFactors = await this.getTemporalFactors();
		const relativePosition = await this.getUserRelativePosition(userId, dimension);

		return {
			userPopulation,
			systemState,
			temporalFactors,
			relativePosition,
			...partialContext,
		};
	}

	private async getUserPopulationStats() {
		const total = await this.usersRepository.count({ where: { host: IsNull() } });
		const active = await this.usersRepository.count({
			where: {
				host: IsNull(),
				lastActiveDate: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
			},
		});

		const percentiles: Record<string, number[]> = {};
		const distributions: Record<string, Distribution> = {};

		const dimensions = ['accountAge', 'postingFrequency', 'followRatio'];
		for (const dim of dimensions) {
			try {
				const dist = await this.getDistribution(dim);
				percentiles[dim] = [dist.min, dist.q1, dist.median, dist.q3, dist.max];
				distributions[dim] = dist;
			} catch (error) {
				console.warn(`Failed to get distribution for ${dim}:`, error);
			}
		}

		return { total, active, percentiles, distributions };
	}

	private async getSystemState() {
		const attackLevel = parseFloat(await this.redisClient.get('system:attack-level') || '0');
		const spamLevel = parseFloat(await this.redisClient.get('system:spam-level') || '0');
		const overallHealth = parseFloat(await this.redisClient.get('system:health') || '1');

		return { attackLevel, spamLevel, overallHealth };
	}

	private async getTemporalFactors() {
		const now = new Date();
		const hour = now.getHours();
		const day = now.getDay();
		const month = now.getMonth();

		const timeOfDay = hour >= 2 && hour <= 6 ? 0.7 : 1;
		const dayOfWeek = day === 0 || day === 6 ? 0.9 : 1;
		const seasonality = month === 11 || month === 0 ? 0.95 : 1;
		const trend = await this.getTrendFactor();

		return { timeOfDay, dayOfWeek, seasonality, trend };
	}

	private async getTrendFactor(): Promise<number> {
		return await this.calculateTrendFactor();
	}

	private async calculateTrendFactor(): Promise<number> {
		const key = 'trend:activity';
		const recentActivity = await this.redisClient.lrange(key, 0, 23);

		if (recentActivity.length < 12) {
			return 1;
		}

		const values = recentActivity.map(v => parseFloat(v) || 0);
		const recentAvg = values.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
		const olderAvg = values.slice(6, 12).reduce((a, b) => a + b, 0) / 6;

		if (olderAvg === 0) return 1;

		const trendRatio = recentAvg / olderAvg;

		if (trendRatio > 1.3) return 1.2;
		if (trendRatio > 1.1) return 1.1;
		if (trendRatio < 0.7) return 0.8;
		if (trendRatio < 0.9) return 0.9;

		return 1;
	}

	private async getUserRelativePosition(userId: string, dimension: string) {
		const userValue = await this.getUserDimensionValue(userId, dimension);
		const distribution = await this.getDistribution(dimension);

		const percentile = await this.calculatePercentileRank(dimension, userValue);
		const zScore = (userValue - distribution.mean) / (distribution.std || 1);
		const deviation = Math.abs(zScore);

		return { percentile, zScore, deviation };
	}

	private async getUserDimensionValue(userId: string, dimension: string): Promise<number> {
		const key = `user:dimension:${dimension}:${userId}`;
		const value = await this.redisClient.get(key);
		return value ? parseFloat(value) : 0;
	}

	private async getSampleValues(dimension: string, sampleSize: number): Promise<number[]> {
		try {
			const samples = await this.sampleDataCache.fetch(dimension);
			return samples.slice(0, sampleSize);
		} catch (error) {
			console.warn(`Failed to get sample values for ${dimension}:`, error);
			return [0.1, 0.5, 1.0, 2.0, 5.0];
		}
	}

	private async batchGetDistributions(dimensions: string[]): Promise<Map<string, Distribution>> {
		const distributions = new Map<string, Distribution>();

		await Promise.all(dimensions.map(async dim => {
			const dist = await this.getDistribution(dim);
			distributions.set(dim, dist);
		}));

		return distributions;
	}

	private getDefaultDistribution(): Distribution {
		return {
			mean: 0.5,
			median: 0.5,
			std: 0.2,
			min: 0,
			max: 1,
			q1: 0.25,
			q3: 0.75,
			iqr: 0.5,
			skewness: 0,
			kurtosis: 0,
		};
	}

	private mean(values: number[]): number {
		return values.reduce((a, b) => a + b, 0) / values.length;
	}

	private median(values: number[]): number {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	private standardDeviation(values: number[]): number {
		const avg = this.mean(values);
		const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
		return Math.sqrt(this.mean(squaredDiffs));
	}

	private percentile(values: number[], p: number): number {
		const sorted = [...values].sort((a, b) => a - b);
		const index = (p / 100) * (sorted.length - 1);
		const lower = Math.floor(index);
		const upper = Math.ceil(index);
		const weight = index % 1;
		return sorted[lower] * (1 - weight) + sorted[upper] * weight;
	}

	private calculateSkewness(values: number[], mean: number, std: number): number {
		if (std === 0) return 0;
		const n = values.length;
		const sum = values.reduce((acc, v) => acc + Math.pow((v - mean) / std, 3), 0);
		return (n / ((n - 1) * (n - 2))) * sum;
	}

	private calculateKurtosis(values: number[], mean: number, std: number): number {
		if (std === 0) return 0;
		const n = values.length;
		const sum = values.reduce((acc, v) => acc + Math.pow((v - mean) / std, 4), 0);
		return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum -
			   (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
	}

	private erf(x: number): number {
		const a1 = 0.254829592;
		const a2 = -0.284496736;
		const a3 = 1.421413741;
		const a4 = -1.453152027;
		const a5 = 1.061405429;
		const p = 0.3275911;

		const sign = x < 0 ? -1 : 1;
		x = Math.abs(x);

		const t = 1 / (1 + p * x);
		const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

		return sign * y;
	}

	@bindThis
	private async updateDistributions(): Promise<void> {
		const dimensions = [
			'accountAge', 'postingFrequency', 'followRatio',
			'contentDiversity', 'interactionRate', 'loginFrequency',
		];

		for (const dim of dimensions) {
			await this.distributionCache.delete(dim);
			await this.getDistribution(dim);
		}
	}

	@bindThis
	private async updateTrendAnalysis(): Promise<void> {
		const now = new Date();
		const hourlyKey = 'trend:activity';

		const activeUsers = await this.usersRepository.count({
			where: {
				host: IsNull(),
				lastActiveDate: MoreThan(new Date(now.getTime() - 60 * 60 * 1000)),
			},
		});

		await this.redisClient.lpush(hourlyKey, activeUsers.toString());
		await this.redisClient.ltrim(hourlyKey, 0, 167);
		await this.redisClient.expire(hourlyKey, 7 * 24 * 60 * 60);
	}

	private async collectSampleFromDatabase(dimension: string): Promise<number[]> {
		try {
			const sampleUsers = await this.usersRepository.find({
				where: {
					host: IsNull(),
					lastActiveDate: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
				},
				order: {
					lastActiveDate: 'DESC',
				},
				take: 500,
			});

			const values: number[] = [];

			for (const user of sampleUsers) {
				let value = 0;
				switch (dimension) {
					case 'accountAge': {
						const createdAt = this.idService.parse(user.id).date;
						value = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
						break;
					}
					case 'postingFrequency': {
						const accountCreated = this.idService.parse(user.id).date;
						const accountAgeDays = Math.max(1, (Date.now() - accountCreated.getTime()) / (1000 * 60 * 60 * 24));
						value = user.notesCount / accountAgeDays;
						break;
					}
					case 'followRatio':
						value = user.followersCount > 0 ? user.followingCount / user.followersCount : 0;
						break;
					default:
						value = Math.random();
				}

				if (!isNaN(value) && isFinite(value)) {
					values.push(value);
				}
			}

			return values.length > 0 ? values : [0.1, 0.5, 1.0, 2.0, 5.0];
		} catch (error) {
			console.warn(`Failed to collect samples from database for ${dimension}:`, error);
			return [0.1, 0.5, 1.0, 2.0, 5.0];
		}
	}
}
