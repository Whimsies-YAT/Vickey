/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import type { UsersRepository, NotesRepository } from '@/models/_.js';

export interface RehabilitationFactors {
	improvementBonus: number;
	consistencyBonus: number;
	dormancyBonus: number;
	recoveryMultiplier: number;

	penaltyDecay: number;
	forgivenessFactor: number;

	historicalPenalties: PenaltyRecord[];
	historicalRewards: RewardRecord[];

	finalAdjustment: number;
	adjustmentReasons: string[];
}

export interface PenaltyRecord {
	timestamp: Date;
	type: string;
	severity: number;
	decayed: boolean;
	currentWeight: number;
}

export interface RewardRecord {
	timestamp: Date;
	type: string;
	value: number;
	reason: string;
}

export interface BehaviorTrend {
	direction: 'improving' | 'stable' | 'declining';
	confidence: number;
	recentScore: number;
	historicalAverage: number;
	volatility: number;
}

export interface DormancyAnalysis {
	isDormant: boolean;
	dormancyDays: number;
	lastActiveDate: Date;
	dormancyScore: number;
	suspicionLevel: number;
}

@Injectable()
export class RiskScoreRehabilitationService {
	private readonly config = {
		improvementThreshold: 0.2,
		maxImprovementBonus: 5,
		consistencyWindow: 30,

		dormancyThreshold: 7,
		maxDormancyBonus: 0.5,
		suspiciousDormancy: 180,

		penaltyHalfLife: 30,
		maxPenaltyAge: 365,

		forgivenessTrigger: 65,
		forgivenessRate: 0.1,
	};

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,
	) {}

	@bindThis
	public async calculateRehabilitationFactors(
		userId: string,
		currentScore: number,
		dimensions: Record<string, number>
	): Promise<RehabilitationFactors> {
		const [penalties, rewards] = await Promise.all([
			this.getPenaltyHistory(userId),
			this.getRewardHistory(userId),
		]);

		const trend = await this.analyzeBehaviorTrend(userId, currentScore);
		const dormancy = await this.analyzeDormancy(userId);
		const improvementBonus = this.calculateImprovementBonus(trend, penalties);
		const consistencyBonus = await this.calculateConsistencyBonus(userId, dimensions);
		const dormancyBonus = this.calculateDormancyBonus(dormancy);
		const decayedPenalties = this.applyPenaltyDecay(penalties);
		const penaltyWeight = this.calculatePenaltyWeight(decayedPenalties);

		const forgivenessFactor = this.calculateForgivenessFactor(
			currentScore,
			trend,
			penalties
		);

		const recoveryMultiplier = this.calculateRecoveryMultiplier(
			trend,
			consistencyBonus,
			forgivenessFactor
		);

		const adjustmentReasons = this.generateAdjustmentReasons(
			trend,
			dormancy,
			improvementBonus,
			consistencyBonus,
			forgivenessFactor
		);

		const finalAdjustment = this.calculateFinalAdjustment(
			improvementBonus,
			consistencyBonus,
			dormancyBonus,
			penaltyWeight,
			recoveryMultiplier
		);

		return {
			improvementBonus,
			consistencyBonus,
			dormancyBonus,
			recoveryMultiplier,
			penaltyDecay: 1 - penaltyWeight,
			forgivenessFactor,
			historicalPenalties: decayedPenalties,
			historicalRewards: rewards,
			finalAdjustment,
			adjustmentReasons,
		};
	}

	@bindThis
	private async analyzeBehaviorTrend(
		userId: string,
		currentScore: number
	): Promise<BehaviorTrend> {
		const historicalScores = await this.getHistoricalScores(userId, 30);

		if (historicalScores.length < 7) {
			return {
				direction: 'stable',
				confidence: 0.3,
				recentScore: currentScore,
				historicalAverage: currentScore,
				volatility: 0,
			};
		}

		const recentScores = historicalScores.slice(-7);
		const olderScores = historicalScores.slice(0, -7);

		const recentAvg = this.average(recentScores);
		const olderAvg = this.average(olderScores);
		const overallAvg = this.average(historicalScores);

		const volatility = this.standardDeviation(historicalScores) / overallAvg;

		let direction: 'improving' | 'stable' | 'declining';
		const improvement = recentAvg - olderAvg;

		if (improvement > overallAvg * 0.1) {
			direction = 'improving';
		} else if (improvement < -overallAvg * 0.1) {
			direction = 'declining';
		} else {
			direction = 'stable';
		}

		const confidence = Math.min(0.95,
			(historicalScores.length / 30) * (1 - volatility)
		);

		return {
			direction,
			confidence,
			recentScore: recentAvg,
			historicalAverage: overallAvg,
			volatility,
		};
	}

	@bindThis
	private async analyzeDormancy(userId: string): Promise<DormancyAnalysis> {
		const user = await this.usersRepository.findOneByOrFail({ id: userId });
		const lastActiveDate = user.lastActiveDate || user.updatedAt || new Date(0);
		const dormancyDays = (Date.now() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);

		const isDormant = dormancyDays >= this.config.dormancyThreshold;

		let dormancyScore = 0;
		if (isDormant) {
			dormancyScore = Math.min(
				this.config.maxDormancyBonus,
				Math.log10(dormancyDays / this.config.dormancyThreshold) * 0.1
			);
		}

		let suspicionLevel = 0;
		if (dormancyDays > this.config.suspiciousDormancy) {
			suspicionLevel = Math.min(1, dormancyDays / 365);
		}

		return {
			isDormant,
			dormancyDays,
			lastActiveDate,
			dormancyScore,
			suspicionLevel,
		};
	}

	@bindThis
	private calculateImprovementBonus(
		trend: BehaviorTrend,
		penalties: PenaltyRecord[]
	): number {
		if (trend.direction !== 'improving') {
			return 0;
		}

		let bonus = Math.min(
			this.config.maxImprovementBonus,
			(trend.recentScore - trend.historicalAverage) / 10
		);

		if (penalties.length > 0) {
			const recentPenalties = penalties.filter(p =>
				(Date.now() - p.timestamp.getTime()) < 30 * 24 * 60 * 60 * 1000
			);

			if (recentPenalties.length === 0 && penalties.length > 0) {
				bonus *= 1.5;
			}
		}

		return bonus * trend.confidence;
	}

	@bindThis
	private async calculateConsistencyBonus(
		userId: string,
		dimensions: Record<string, number>
	): Promise<number> {
		const historicalData = await this.getHistoricalDimensions(userId, 30);

		if (historicalData.length < 7) {
			return 0;
		}

		let totalStability = 0;
		let dimensionCount = 0;

		for (const dim in dimensions) {
			const historicalValues = historicalData.map(d => d[dim] || 0);
			const currentValue = dimensions[dim];

			const mean = this.average(historicalValues);
			const std = this.standardDeviation(historicalValues);
			const cv = mean > 0 ? std / mean : 0;

			const stability = Math.max(0, 1 - cv);

			const deviation = Math.abs(currentValue - mean) / (mean || 1);
			if (deviation < 0.2) {
				totalStability += stability * 1.2;
			} else {
				totalStability += stability;
			}

			dimensionCount++;
		}

		return dimensionCount > 0 ? totalStability / dimensionCount : 0;
	}

	@bindThis
	private calculateDormancyBonus(dormancy: DormancyAnalysis): number {
		if (!dormancy.isDormant) {
			return 0;
		}

		const suspicionPenalty = 1 - dormancy.suspicionLevel * 0.9;

		return dormancy.dormancyScore * suspicionPenalty;
	}

	@bindThis
	private applyPenaltyDecay(penalties: PenaltyRecord[]): PenaltyRecord[] {
		const now = Date.now();

		return penalties.map(penalty => {
			const age = (now - penalty.timestamp.getTime()) / (1000 * 60 * 60 * 24);

			if (age > this.config.maxPenaltyAge) {
				return { ...penalty, currentWeight: 0, decayed: true };
			}

			const decayFactor = Math.pow(0.5, age / this.config.penaltyHalfLife);
			const currentWeight = penalty.severity * decayFactor;

			return {
				...penalty,
				currentWeight,
				decayed: decayFactor < 0.5,
			};
		}).filter(p => p.currentWeight > 0.01);
	}

	@bindThis
	private calculatePenaltyWeight(penalties: PenaltyRecord[]): number {
		if (penalties.length === 0) return 0;

		const totalWeight = penalties.reduce((sum, p) => sum + p.currentWeight, 0);
		const maxPossibleWeight = penalties.length * 10;

		return Math.min(1, totalWeight / maxPossibleWeight);
	}

	@bindThis
	private calculateForgivenessFactor(
		currentScore: number,
		trend: BehaviorTrend,
		penalties: PenaltyRecord[]
	): number {
		if (penalties.length === 0) return 0;

		if (currentScore < this.config.forgivenessTrigger) return 0;

		if (trend.direction === 'declining') return 0;

		let forgiveness = this.config.forgivenessRate;

		if (trend.direction === 'improving') {
			forgiveness *= 1.5;
		}

		const oldestPenalty = Math.min(...penalties.map(p => p.timestamp.getTime()));
		const timeSinceOldest = (Date.now() - oldestPenalty) / (1000 * 60 * 60 * 24);

		if (timeSinceOldest > 90) {
			forgiveness *= 1.2;
		}

		return Math.min(1, forgiveness);
	}

	@bindThis
	private calculateRecoveryMultiplier(
		trend: BehaviorTrend,
		consistencyBonus: number,
		forgivenessFactor: number
	): number {
		let multiplier = 1;

		if (trend.direction === 'improving') {
			multiplier += 0.3 * trend.confidence;
		}

		multiplier += consistencyBonus * 0.2;

		multiplier += forgivenessFactor * 0.5;

		return Math.min(2, multiplier);
	}

	@bindThis
	private calculateFinalAdjustment(
		improvementBonus: number,
		consistencyBonus: number,
		dormancyBonus: number,
		penaltyWeight: number,
		recoveryMultiplier: number
	): number {
		const positiveAdjustment = (
			improvementBonus * 2 +
			consistencyBonus * 1.5 +
			dormancyBonus * 0.5
		) * recoveryMultiplier;

		const negativeAdjustment = penaltyWeight * 5;

		const totalAdjustment = positiveAdjustment - negativeAdjustment;

		return Math.max(-10, Math.min(10, totalAdjustment));
	}

	@bindThis
	private generateAdjustmentReasons(
		trend: BehaviorTrend,
		dormancy: DormancyAnalysis,
		improvementBonus: number,
		consistencyBonus: number,
		forgivenessFactor: number
	): string[] {
		const reasons: string[] = [];

		if (trend.direction === 'improving' && improvementBonus > 0) {
			reasons.push(`Behavioral improvement incentives +${improvementBonus.toFixed(2)}`);
		}

		if (consistencyBonus > 0.5) {
			reasons.push(`Rewards for sustained good behavior +${consistencyBonus.toFixed(2)}`);
		}

		if (dormancy.isDormant && dormancy.dormancyScore > 0) {
			reasons.push(`Dormant Account Tiny Rewards +${dormancy.dormancyScore.toFixed(3)}`);
		}

		if (forgivenessFactor > 0) {
			reasons.push(`History punishes forgiveness ${(forgivenessFactor * 100).toFixed(0)}%`);
		}

		if (trend.direction === 'declining') {
			reasons.push('Deteriorating behavior, suspension of incentives');
		}

		if (dormancy.suspicionLevel > 0.7) {
			reasons.push('Activated after a long period of dormancy, needs to be observed');
		}

		return reasons;
	}

	private async getPenaltyHistory(userId: string): Promise<PenaltyRecord[]> {
		const key = `user:penalties:${userId}`;
		const data = await this.redisClient.lrange(key, 0, -1);
		return data.map((d: string) => JSON.parse(d));
	}

	private async getRewardHistory(userId: string): Promise<RewardRecord[]> {
		const key = `user:rewards:${userId}`;
		const data = await this.redisClient.lrange(key, 0, -1);
		return data.map((d: string) => JSON.parse(d));
	}

	private async getHistoricalScores(userId: string, days: number): Promise<number[]> {
		const key = `user:score:history:${userId}`;
		const data = await this.redisClient.lrange(key, 0, days - 1);
		return data.map((d: string) => parseFloat(d));
	}

	private async getHistoricalDimensions(
		userId: string,
		days: number
	): Promise<Record<string, number>[]> {
		const key = `user:dimensions:history:${userId}`;
		const data = await this.redisClient.lrange(key, 0, days - 1);
		return data.map((d: string) => JSON.parse(d));
	}

	private average(values: number[]): number {
		if (values.length === 0) return 0;
		return values.reduce((a, b) => a + b, 0) / values.length;
	}

	private standardDeviation(values: number[]): number {
		if (values.length === 0) return 0;
		const avg = this.average(values);
		const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
		return Math.sqrt(this.average(squaredDiffs));
	}

	@bindThis
	public async recordPenalty(
		userId: string,
		type: string,
		severity: number
	): Promise<void> {
		const penalty: PenaltyRecord = {
			timestamp: new Date(),
			type,
			severity: Math.min(10, Math.max(1, severity)),
			decayed: false,
			currentWeight: severity,
		};

		const key = `user:penalties:${userId}`;
		await this.redisClient.lpush(key, JSON.stringify(penalty));
		await this.redisClient.ltrim(key, 0, 99);
		await this.redisClient.expire(key, 365 * 24 * 60 * 60);
	}

	@bindThis
	public async recordReward(
		userId: string,
		type: string,
		value: number,
		reason: string
	): Promise<void> {
		const reward: RewardRecord = {
			timestamp: new Date(),
			type,
			value,
			reason,
		};

		const key = `user:rewards:${userId}`;
		await this.redisClient.lpush(key, JSON.stringify(reward));
		await this.redisClient.ltrim(key, 0, 99);
		await this.redisClient.expire(key, 90 * 24 * 60 * 60);
	}
}
