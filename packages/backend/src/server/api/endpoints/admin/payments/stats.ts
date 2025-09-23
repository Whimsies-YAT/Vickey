/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { StripePaymentsRepository } from '@/models/_.js';
import { Inject } from '@nestjs/common';
import { IsNull, Not, MoreThanOrEqual } from 'typeorm';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	secure: true,
	// kind: 'read:admin:payments',

	res: {
		type: 'object',
		properties: {
			totalPayments: { type: 'number' },
			totalAmount: { type: 'number' },
			recentPayments: { type: 'number' },
			statusBreakdown: {
				type: 'object',
				properties: {
					succeeded: { type: 'number' },
					pending: { type: 'number' },
					failed: { type: 'number' },
					canceled: { type: 'number' },
				},
			},
			currencyBreakdown: { type: 'object' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - ps.days);

			// Total payments count
			const totalPayments = await this.stripePaymentsRepository.count({
				where: {
					amount: Not(IsNull()), // Only actual payments
				},
			});

			// Total amount (only succeeded payments)
			const totalAmountResult = await this.stripePaymentsRepository
				.createQueryBuilder('payment')
				.select('SUM(payment.amount)', 'total')
				.where('payment.status = :status', { status: 'succeeded' })
				.andWhere('payment.amount IS NOT NULL')
				.getRawOne();

			const totalAmount = totalAmountResult?.total || 0;

			// Recent payments (within specified days)
			const recentPayments = await this.stripePaymentsRepository.count({
				where: {
					createdAt: MoreThanOrEqual(cutoffDate),
					amount: Not(IsNull()),
				},
			});

			// Status breakdown
			const statusResults = await this.stripePaymentsRepository
				.createQueryBuilder('payment')
				.select(['payment.status', 'COUNT(*) as count'])
				.where('payment.amount IS NOT NULL')
				.groupBy('payment.status')
				.getRawMany();

			const statusBreakdown = {
				succeeded: 0,
				pending: 0,
				failed: 0,
				canceled: 0,
			};

			statusResults.forEach((result: any) => {
				const status = result.payment_status as keyof typeof statusBreakdown;
				if (status in statusBreakdown) {
					statusBreakdown[status] = parseInt(result.count);
				}
			});

			// Currency breakdown (only succeeded payments)
			const currencyResults = await this.stripePaymentsRepository
				.createQueryBuilder('payment')
				.select(['payment.currency', 'COUNT(*) as count', 'SUM(payment.amount) as total'])
				.where('payment.status = :status', { status: 'succeeded' })
				.andWhere('payment.amount IS NOT NULL')
				.groupBy('payment.currency')
				.getRawMany();

			const currencyBreakdown: Record<string, { count: number; total: number }> = {};
			currencyResults.forEach((result: any) => {
				currencyBreakdown[result.payment_currency] = {
					count: parseInt(result.count),
					total: parseFloat(result.total) || 0,
				};
			});

			return {
				totalPayments,
				totalAmount,
				recentPayments,
				statusBreakdown,
				currencyBreakdown,
			};
		});
	}
}
