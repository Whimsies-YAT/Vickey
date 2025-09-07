/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IsNull } from "typeorm";

export const meta = {
	tags: ['admin', 'users'],

	requireCredential: true,
	requireAdmin: true,
	secure: true,
	kind: 'read:admin:risk-scores',

	res: {
		type: 'array',
		nullable: false,
		optional: false,
		items: {
			type: 'object',
			nullable: false,
			optional: false,
			properties: {
				user: {
					type: 'object',
					nullable: false,
					optional: false,
					ref: 'UserDetailed',
				},
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
				calculatedAt: {
					type: 'string',
					nullable: false,
					optional: false,
					format: 'date-time',
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		offset: { type: 'integer', default: 0 },
		riskLevel: {
			type: 'string',
			enum: ['poor', 'fair'],
			nullable: true,
		},
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userRiskScoreService: UserRiskScoreService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const users = await this.usersRepository.find({
				where: {
					host: IsNull(),
				},
				take: 1000,
			});

			const highRiskUsers = [];

			for (const user of users) {
				const cachedScore = await this.userRiskScoreService.getCachedScore(user.id);

				if (cachedScore) {
					if (ps.riskLevel) {
						if (cachedScore.riskLevel === ps.riskLevel) {
							highRiskUsers.push({
								user,
								score: cachedScore,
							});
						}
					} else {
						if (cachedScore.riskLevel === 'poor' || (cachedScore.riskLevel === 'fair')) {
							highRiskUsers.push({
								user,
								score: cachedScore,
							});
						}
					}
				}
			}

			highRiskUsers.sort((a, b) => a.score.totalScore - b.score.totalScore);

			const paginatedUsers = highRiskUsers.slice(ps.offset, ps.offset + ps.limit);

			return await Promise.all(paginatedUsers.map(async (item) => ({
				user: await this.userEntityService.pack(item.user, me, {schema: 'UserDetailed'}),
				totalScore: item.score.totalScore,
				riskLevel: item.score.riskLevel,
				calculatedAt: new Date().toISOString(),
			})));
		});
	}
}
