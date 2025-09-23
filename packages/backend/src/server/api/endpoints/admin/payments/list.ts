/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { DI } from '@/di-symbols.js';
import type { StripePaymentsRepository, UsersRepository } from '@/models/_.js';
import { Inject } from '@nestjs/common';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	secure: true,
	// kind: 'read:admin:payments',

	res: {
		type: 'array',
		items: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				paymentIntentId: { type: 'string' },
				amount: { type: 'number' },
				currency: { type: 'string' },
				status: { type: 'string' },
				description: { type: 'string', nullable: true },
				userId: { type: 'string', nullable: true },
				user: {
					type: 'object',
					nullable: true,
					properties: {
						id: { type: 'string' },
						username: { type: 'string' },
						name: { type: 'string', nullable: true },
					},
				},
				createdAt: { type: 'string', format: 'date-time' },
				updatedAt: { type: 'string', format: 'date-time' },
				metadata: { type: 'object', nullable: true },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: ['pending', 'succeeded', 'failed', 'canceled'], nullable: true },
		userId: { type: 'string', format: 'misskey:id', nullable: true },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps) => {
			const query = this.queryService.makePaginationQuery(
				this.stripePaymentsRepository.createQueryBuilder('payment'),
				ps.sinceId,
				ps.untilId,
			)
				.andWhere('payment.amount IS NOT NULL') // Only show actual payments
				.leftJoinAndSelect('payment.user', 'user');

			if (ps.status) {
				query.andWhere('payment.status = :status', { status: ps.status });
			}

			if (ps.userId) {
				query.andWhere('payment.userId = :userId', { userId: ps.userId });
			}

			query.orderBy('payment.createdAt', 'DESC')
				.limit(ps.limit);

			const payments = await query.getMany();

			return payments.map(payment => ({
				id: payment.id,
				paymentIntentId: payment.stripePaymentIntentId,
				amount: payment.amount,
				currency: payment.currency,
				status: payment.status,
				description: payment.description,
				userId: payment.userId,
				user: payment.user ? {
					id: payment.user.id,
					username: payment.user.username,
					name: payment.user.name,
				} : null,
				createdAt: payment.createdAt.toISOString(),
				updatedAt: payment.updatedAt.toISOString(),
				metadata: payment.metadata,
			}));
		});
	}
}
