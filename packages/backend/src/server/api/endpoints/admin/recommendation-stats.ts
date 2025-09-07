/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { 
	ContentRecommendationLogRepository,
	UserInteractionHistoryRepository,
	UserRecommendationProfileRepository
} from '@/models/_.js';
import { MoreThan } from 'typeorm';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,

	res: {
		type: 'object',
		properties: {
			totalRecommendations: { type: 'number' },
			totalInteractions: { type: 'number' },
			totalProfiles: { type: 'number' },
			engagementRate: { type: 'number' },
			viewRate: { type: 'number' },
			algorithmPerformance: {
				type: 'object',
				additionalProperties: {
					type: 'object',
					properties: {
						recommendations: { type: 'number' },
						engagements: { type: 'number' },
						engagementRate: { type: 'number' },
					},
				},
			},
			contextPerformance: {
				type: 'object',
				additionalProperties: {
					type: 'object',
					properties: {
						recommendations: { type: 'number' },
						engagements: { type: 'number' },
						engagementRate: { type: 'number' },
					},
				},
			},
			recentActivity: {
				type: 'object',
				properties: {
					last24h: {
						type: 'object',
						properties: {
							recommendations: { type: 'number' },
							interactions: { type: 'number' },
							uniqueUsers: { type: 'number' },
						},
					},
					last7d: {
						type: 'object',
						properties: {
							recommendations: { type: 'number' },
							interactions: { type: 'number' },
							uniqueUsers: { type: 'number' },
						},
					},
				},
			},
			topInteractionTypes: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						type: { type: 'string' },
						count: { type: 'number' },
						percentage: { type: 'number' },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.contentRecommendationLogRepository)
		private contentRecommendationLogRepository: ContentRecommendationLogRepository,

		@Inject(DI.userInteractionHistoryRepository)
		private userInteractionHistoryRepository: UserInteractionHistoryRepository,

		@Inject(DI.userRecommendationProfileRepository)
		private userRecommendationProfileRepository: UserRecommendationProfileRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const daysAgo = new Date(Date.now() - ps.days * 24 * 60 * 60 * 1000);
			const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

			// Basic counts
			const [totalRecommendations, totalInteractions, totalProfiles] = await Promise.all([
				this.contentRecommendationLogRepository.count({
					where: { createdAt: MoreThan(daysAgo) },
				}),
				this.userInteractionHistoryRepository.count({
					where: { createdAt: MoreThan(daysAgo) },
				}),
				this.userRecommendationProfileRepository.count(),
			]);

			// Engagement metrics
			const [totalEngagements, totalViews] = await Promise.all([
				this.contentRecommendationLogRepository.count({
					where: { 
						createdAt: MoreThan(daysAgo),
						engaged: true,
					},
				}),
				this.contentRecommendationLogRepository.count({
					where: { 
						createdAt: MoreThan(daysAgo),
						viewed: true,
					},
				}),
			]);

			const engagementRate = totalRecommendations > 0 ? totalEngagements / totalRecommendations : 0;
			const viewRate = totalRecommendations > 0 ? totalViews / totalRecommendations : 0;

			// Algorithm performance
			const algorithmStats = await this.contentRecommendationLogRepository
				.createQueryBuilder('log')
				.select('log.algorithm')
				.addSelect('COUNT(*)', 'recommendations')
				.addSelect('SUM(CASE WHEN log.engaged = true THEN 1 ELSE 0 END)', 'engagements')
				.where('log.createdAt > :daysAgo', { daysAgo })
				.groupBy('log.algorithm')
				.getRawMany();

			const algorithmPerformance: Record<string, any> = {};
			for (const stat of algorithmStats) {
				const recommendations = parseInt(stat.recommendations);
				const engagements = parseInt(stat.engagements);
				algorithmPerformance[stat.algorithm] = {
					recommendations,
					engagements,
					engagementRate: recommendations > 0 ? engagements / recommendations : 0,
				};
			}

			// Context performance
			const contextStats = await this.contentRecommendationLogRepository
				.createQueryBuilder('log')
				.select('log.context')
				.addSelect('COUNT(*)', 'recommendations')
				.addSelect('SUM(CASE WHEN log.engaged = true THEN 1 ELSE 0 END)', 'engagements')
				.where('log.createdAt > :daysAgo', { daysAgo })
				.groupBy('log.context')
				.getRawMany();

			const contextPerformance: Record<string, any> = {};
			for (const stat of contextStats) {
				const recommendations = parseInt(stat.recommendations);
				const engagements = parseInt(stat.engagements);
				contextPerformance[stat.context] = {
					recommendations,
					engagements,
					engagementRate: recommendations > 0 ? engagements / recommendations : 0,
				};
			}

			// Recent activity
			const [
				recommendations24h,
				interactions24h,
				uniqueUsers24h,
				recommendations7d,
				interactions7d,
				uniqueUsers7d,
			] = await Promise.all([
				this.contentRecommendationLogRepository.count({
					where: { createdAt: MoreThan(oneDayAgo) },
				}),
				this.userInteractionHistoryRepository.count({
					where: { createdAt: MoreThan(oneDayAgo) },
				}),
				this.contentRecommendationLogRepository
					.createQueryBuilder('log')
					.select('COUNT(DISTINCT log.userId)', 'count')
					.where('log.createdAt > :oneDayAgo', { oneDayAgo })
					.getRawOne()
					.then(result => parseInt(result.count)),
				this.contentRecommendationLogRepository.count({
					where: { createdAt: MoreThan(sevenDaysAgo) },
				}),
				this.userInteractionHistoryRepository.count({
					where: { createdAt: MoreThan(sevenDaysAgo) },
				}),
				this.contentRecommendationLogRepository
					.createQueryBuilder('log')
					.select('COUNT(DISTINCT log.userId)', 'count')
					.where('log.createdAt > :sevenDaysAgo', { sevenDaysAgo })
					.getRawOne()
					.then(result => parseInt(result.count)),
			]);

			// Top interaction types
			const interactionTypeStats = await this.userInteractionHistoryRepository
				.createQueryBuilder('interaction')
				.select('interaction.interactionType', 'type')
				.addSelect('COUNT(*)', 'count')
				.where('interaction.createdAt > :daysAgo', { daysAgo })
				.groupBy('interaction.interactionType')
				.orderBy('COUNT(*)', 'DESC')
				.limit(10)
				.getRawMany();

			const totalInteractionCount = interactionTypeStats.reduce((sum, stat) => sum + parseInt(stat.count), 0);
			const topInteractionTypes = interactionTypeStats.map(stat => ({
				type: stat.type,
				count: parseInt(stat.count),
				percentage: totalInteractionCount > 0 ? parseInt(stat.count) / totalInteractionCount : 0,
			}));

			return {
				totalRecommendations,
				totalInteractions,
				totalProfiles,
				engagementRate,
				viewRate,
				algorithmPerformance,
				contextPerformance,
				recentActivity: {
					last24h: {
						recommendations: recommendations24h,
						interactions: interactions24h,
						uniqueUsers: uniqueUsers24h,
					},
					last7d: {
						recommendations: recommendations7d,
						interactions: interactions7d,
						uniqueUsers: uniqueUsers7d,
					},
				},
				topInteractionTypes,
			};
		});
	}
}
