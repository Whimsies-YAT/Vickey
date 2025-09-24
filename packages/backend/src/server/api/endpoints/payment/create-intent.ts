/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';
import { ApiError } from '../../error.js';
import type { UserProfilesRepository, StripePaymentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';

export const meta = {
	tags: ['payment'],

	requireCredential: true,
	secure: true,

	res: {
		type: 'object',
		properties: {
			clientSecret: {
				type: 'string',
			},
			paymentIntentId: {
				type: 'string',
			},
		},
	},

	errors: {
		stripeNotEnabled: {
			message: 'Stripe is not enabled.',
			code: 'STRIPE_NOT_ENABLED',
			id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
		},
		invalidAmount: {
			message: 'Invalid amount.',
			code: 'INVALID_AMOUNT',
			id: 'b2c3d4e5-f6a7-8901-2345-678901bcdef0',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		amount: { type: 'integer', minimum: 1 },
		currency: { type: 'string', default: 'usd' },
		description: { type: 'string', nullable: true },
		metadata: { type: 'object', nullable: true },
		billingDetails: {
			type: 'object',
			properties: {
				firstName: { type: 'string' },
				lastName: { type: 'string' },
				email: { type: 'string' },
			},
			required: ['firstName', 'lastName', 'email'],
		},
	},
	required: ['amount', 'billingDetails'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,

		private stripeService: StripeService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.stripeService.isEnabled()) {
				throw new ApiError(meta.errors.stripeNotEnabled);
			}

			if (ps.amount < 1) {
				throw new ApiError(meta.errors.invalidAmount);
			}

			const billingEmail = ps.billingDetails.email;
			const billingName = `${ps.billingDetails.firstName} ${ps.billingDetails.lastName}`.trim();

			const customer = await this.stripeService.findOrCreateCustomer({
				userId: me.id,
				email: billingEmail,
				name: billingName,
			});

			const paymentIntent = await this.stripeService.createPaymentIntent({
				amount: ps.amount,
				currency: ps.currency,
				customerId: customer.id,
				description: ps.description || undefined,
				metadata: {
					userId: me.id,
					...ps.metadata,
				},
			});

			await this.stripePaymentsRepository.insert({
				id: this.idService.gen(),
				userId: me.id,
				stripePaymentIntentId: paymentIntent.id,
				stripeCustomerId: customer.id,
				amount: ps.amount,
				currency: ps.currency,
				status: paymentIntent.status as any,
				description: ps.description || null,
				metadata: paymentIntent.metadata ? JSON.parse(JSON.stringify(paymentIntent.metadata)) : {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			return {
				clientSecret: paymentIntent.client_secret!,
				paymentIntentId: paymentIntent.id,
			};
		});
	}
}
