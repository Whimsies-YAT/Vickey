/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin', 'users'],

	requireCredential: true,
	requireAdmin: true,
	secure: true,
	kind: 'read:admin:risk-scores',

	res: {
		type: 'object',
		nullable: false,
		optional: false,
		properties: {
			totalScore: {
				type: 'number',
				nullable: false,
				optional: false,
			},
			riskLevel: {
				type: 'string',
				nullable: false,
				optional: false,
				enum: ['poor', 'fair', 'good', 'veryGood', 'excellent'],
			},
			details: {
				type: 'object',
				nullable: false,
				optional: false,
				properties: {
					profileScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
					activityScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
					relationshipScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
					contentScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
					engagementScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
					multiAccountScore: {
						type: 'number',
						nullable: false,
						optional: false,
					},
				},
			},
			calculatedAt: {
				type: 'string',
				nullable: false,
				optional: false,
				format: 'date-time',
			},
		},
	},

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '1470c2d7-8d73-4703-a2f2-5bc9e2b824d5',
		},
		unavailable: {
			message: 'Risk score unavailable.',
			code: 'UNAVAILABLE',
			id: '2570c3d8-9e84-5814-b3f3-6cd9e3b935e6',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userRiskScoreService: UserRiskScoreService,
	) {
		super(meta, paramDef, async (ps) => {
			const user = await this.usersRepository.findOneBy({ id: ps.userId });
			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			const score = await this.userRiskScoreService.calculateUserRiskScore(ps.userId);

			if (!score) {
				throw new ApiError(meta.errors.unavailable);
			}

			const dimensions = score.dimensions;

			const profileScore = (dimensions.profileComplete + dimensions.avatarExists + dimensions.emailVerified + dimensions.twoFactorEnabled) / 4;
			const activityScore = (dimensions.loginFrequency + dimensions.postingFrequency + dimensions.postingTimePattern) / 3;
			const relationshipScore = (dimensions.followRatio + dimensions.mutualFollowRate + dimensions.socialGraphDensity) / 3;
			const contentScore = (dimensions.contentDiversity + dimensions.averageNoteLength + dimensions.hashtagUsage) / 3;
			const engagementScore = (dimensions.interactionPattern + dimensions.interactionReciprocity + dimensions.mentionFrequency) / 3;
			const multiAccountScore = 0;

			return {
				totalScore: score.totalScore,
				riskLevel: score.riskLevel,
				details: {
					profileScore,
					activityScore,
					relationshipScore,
					contentScore,
					engagementScore,
					multiAccountScore,
				},
				calculatedAt: score.calculatedAt.toISOString(),
			};
		});
	}
}
