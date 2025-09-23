/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';
import { ApiError } from '../../error.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['payment'],

	requireCredential: true,
	secure: true,

	res: {
		type: 'object',
		properties: {
			subscriptionId: {
				type: 'string',
			},
			status: {
				type: 'string',
			},
			clientSecret: {
				type: 'string',
				nullable: true,
			},
		},
	},

	errors: {
		stripeNotEnabled: {
			message: 'Stripe is not enabled.',
			code: 'STRIPE_NOT_ENABLED',
			id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
		},
		invalidPriceId: {
			message: 'Invalid price ID.',
			code: 'INVALID_PRICE_ID',
			id: 'd4e5f6a7-b8c9-0123-4567-890123def456',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		priceId: { type: 'string' },
		paymentMethodId: { type: 'string', nullable: true },
		trialPeriodDays: { type: 'integer', nullable: true },
		metadata: { type: 'object', nullable: true },
	},
	required: ['priceId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private stripeService: StripeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.stripeService.isEnabled()) {
				throw new ApiError(meta.errors.stripeNotEnabled);
			}

			const userEmail = (await this.userProfilesRepository.findOneBy({ userId: me.id }))?.email ?? null;

			try {
				const customer = await this.stripeService.findOrCreateCustomer({
					userId: me.id,
					email: userEmail || undefined,
					name: me.name || me.username,
				});

				const subscription = await this.stripeService.createSubscription({
					customerId: customer.id,
					priceId: ps.priceId,
					trialPeriodDays: ps.trialPeriodDays || undefined,
					metadata: {
						userId: me.id,
						...ps.metadata,
					},
				});

				let clientSecret = null;

				// Handle client secret for immediate payment confirmation if needed
				if (subscription.latest_invoice && typeof subscription.latest_invoice === 'object') {
					const invoice = subscription.latest_invoice as any;
					if (invoice.payment_intent && typeof invoice.payment_intent === 'object') {
						clientSecret = invoice.payment_intent.client_secret;
					} else if (typeof invoice.payment_intent === 'string') {
						// If payment_intent is just an ID, fetch the full object
						try {
							const paymentIntent = await this.stripeService.getPaymentIntent(invoice.payment_intent);
							clientSecret = paymentIntent.client_secret;
						} catch (error) {
							console.warn('Failed to fetch payment intent details:', error);
						}
					}
				}

				return {
					subscriptionId: subscription.id,
					status: subscription.status,
					clientSecret,
				};
			} catch (error) {
				throw new ApiError(meta.errors.invalidPriceId);
			}
		});
	}
}
