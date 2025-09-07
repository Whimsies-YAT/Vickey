/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { MultiAccountDetectionService } from '@/core/MultiAccountDetectionService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:risk-score',

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '4c3f3b3a-2c3f-4c3f-8c3f-3c3f3b3a2c3f',
		},
		remoteUser: {
			message: 'Cannot get risk score for remote user.',
			code: 'REMOTE_USER',
			id: '5d3f3b3a-3c3f-4c3f-8c3f-3c3f3b3a3c3f',
		},
	},

	res: {
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			userId: {
				type: 'string',
				optional: false,
				nullable: false,
			},
			totalScore: {
				type: 'number',
				optional: false,
				nullable: false,
			},
			riskLevel: {
				type: 'string',
				optional: false,
				nullable: false,
				enum: ['poor', 'fair', 'good', 'veryGood', 'excellent'],
			},
			dimensions: {
				type: 'object',
				optional: false,
				nullable: false,
			},
			details: {
				type: 'object',
				optional: false,
				nullable: false,
			},
			linkedAccounts: {
				type: 'array',
				optional: false,
				nullable: false,
				items: {
					type: 'object',
					properties: {
						userId: {
							type: 'string',
						},
						confidence: {
							type: 'number',
						},
						methods: {
							type: 'array',
							items: {
								type: 'string',
							},
						},
					},
				},
			},
			calculatedAt: {
				type: 'string',
				optional: false,
				nullable: false,
				format: 'date-time',
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		refresh: { type: 'boolean', default: false },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userRiskScoreService: UserRiskScoreService,
		private multiAccountDetectionService: MultiAccountDetectionService,
	) {
		super(meta, paramDef, async (ps) => {
			const user = await this.usersRepository.findOneBy({ id: ps.userId });

			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			if (user.host != null) {
				throw new ApiError(meta.errors.remoteUser);
			}

			let riskScore;
			if (ps.refresh) {
				riskScore = await this.userRiskScoreService.calculateUserRiskScore(user.id);
			} else {
				const cached = await this.userRiskScoreService.getCachedScore(user.id);
				riskScore = cached ?? await this.userRiskScoreService.calculateUserRiskScore(user.id);
			}

			const linkedAccounts = await this.multiAccountDetectionService.getAccountLinks(user.id);

			return {
				userId: riskScore.userId,
				totalScore: riskScore.totalScore,
				riskLevel: riskScore.riskLevel,
				dimensions: riskScore.dimensions,
				details: riskScore.details,
				linkedAccounts: linkedAccounts.map(link => ({
					userId: link.primaryUserId === user.id ? link.linkedUserId : link.primaryUserId,
					confidence: link.confidence,
					methods: link.detectionMethods,
				})),
				calculatedAt: riskScore.calculatedAt.toISOString(),
			};
		});
	}
}
