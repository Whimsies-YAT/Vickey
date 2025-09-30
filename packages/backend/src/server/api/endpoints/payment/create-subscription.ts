/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';
import { ApiError } from '../../error.js';
import type { UserProfilesRepository, StripeSubscriptionsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { MetaService } from '@/core/MetaService.js';

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
		amount: { type: 'number', nullable: true },
	},
	required: ['priceId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.stripeSubscriptionsRepository)
		private stripeSubscriptionsRepository: StripeSubscriptionsRepository,

		private stripeService: StripeService,
		private idService: IdService,
		private metaService: MetaService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.stripeService.isEnabled()) {
				throw new ApiError(meta.errors.stripeNotEnabled);
			}

			const metaData = await this.metaService.fetch();
			const currency = (metaData.stripeCurrency || 'USD').toLowerCase();

			const userEmail = (await this.userProfilesRepository.findOneBy({ userId: me.id }))?.email ?? null;

			try {
				const customer = await this.stripeService.findOrCreateCustomer({
					userId: me.id,
					email: userEmail || undefined,
					name: me.name || me.username,
				});

				let priceId = ps.priceId;

				if (ps.priceId.startsWith('monthly_')) {
					const priceAmount = parseInt(ps.priceId.replace('monthly_', ''));

					if (ps.amount && Math.abs(ps.amount - priceAmount) > 0.01) {
						throw new Error('Amount mismatch: priceId and amount parameter do not match');
					}

					const amount = priceAmount;
					if (!amount || amount <= 0) {
						throw new Error('Invalid donation amount');
					}

					const product = await this.stripeService.createProduct({
						name: `Monthly Donation - $${amount}`,
						description: `Monthly recurring donation of $${amount}`,
						metadata: {
							type: 'donation',
							amount: amount.toString(),
						},
					});

					const price = await this.stripeService.createPrice({
						productId: product.id,
						unitAmount: amount * 100,
						currency: currency,
						recurring: {
							interval: 'month',
						},
					});
					priceId = price.id;
				}

				if (ps.paymentMethodId) {
					await this.stripeService.attachPaymentMethodToCustomer(ps.paymentMethodId, customer.id);
				}

				const subscription = await this.stripeService.createSubscription({
					customerId: customer.id,
					priceId: priceId,
					paymentMethodId: ps.paymentMethodId || undefined,
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

				await this.stripeSubscriptionsRepository.insert({
					id: this.idService.gen(),
					userId: me.id,
					stripeSubscriptionId: subscription.id,
					stripeCustomerId: customer.id,
					stripePriceId: priceId,
					stripeProductId: await this.getProductIdFromPrice(priceId),
					status: subscription.status as any,
					currentPeriodStart: new Date((subscription.items?.data?.[0]?.current_period_start) * 1000),
					currentPeriodEnd: new Date((subscription.items?.data?.[0]?.current_period_end) * 1000),
					metadata: subscription.metadata ? JSON.parse(JSON.stringify(subscription.metadata)) : {},
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				return {
					subscriptionId: subscription.id,
					status: subscription.status,
					clientSecret,
				};
			} catch (error) {
				console.error('Subscription creation error:', error);
				if (error instanceof Error) {
					throw new Error(`Subscription creation failed: ${error.message}`);
				}
				throw new ApiError(meta.errors.invalidPriceId);
			}
		});
	}

	private async getProductIdFromPrice(priceId: string): Promise<string | null> {
		try {
			const price = await this.stripeService.getPrice(priceId);
			if (price && typeof price.product === 'string') {
				return price.product;
			} else if (price && typeof price.product === 'object' && price.product && 'id' in price.product) {
				return price.product.id;
			}
		} catch (error) {
			console.warn('Failed to fetch price details for product ID:', error);
		}
		return null;
	}
}
