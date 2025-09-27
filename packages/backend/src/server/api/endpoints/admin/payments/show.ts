/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { StripePaymentsRepository, UserProfilesRepository } from '@/models/_.js';
import { Inject } from '@nestjs/common';
import { ApiError } from '../../../error.js';
import { StripeService } from '@/core/StripeService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	secure: true,
	// kind: 'read:admin:payments',

	res: {
		type: 'object',
		properties: {
			id: { type: 'string' },
			paymentIntentId: { type: 'string', nullable: true },
			checkoutSessionId: { type: 'string', nullable: true },
			stripePaymentIntentId: { type: 'string', nullable: true },
			stripeCheckoutSessionId: { type: 'string', nullable: true },
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
					email: { type: 'string', nullable: true },
				},
			},
			createdAt: { type: 'string', format: 'date-time' },
			updatedAt: { type: 'string', format: 'date-time' },
			metadata: { type: 'object', nullable: true },
			stripeDetails: { type: 'object', nullable: true },
			paymentMode: { type: 'string' },
			hasCheckoutSession: { type: 'boolean' },
			hasPaymentIntent: { type: 'boolean' },
			rawData: { type: 'object', nullable: true },
		},
	},

	errors: {
		paymentNotFound: {
			message: 'Payment not found.',
			code: 'PAYMENT_NOT_FOUND',
			id: 'f1b2c3d4-e5f6-7890-1234-567890abcdef',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		paymentId: { type: 'string', format: 'misskey:id' },
	},
	required: ['paymentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private stripeService: StripeService,
	) {
		super(meta, paramDef, async (ps) => {
			const payment = await this.stripePaymentsRepository.findOne({
				where: { id: ps.paymentId },
				relations: ['user'],
			});

			if (!payment) {
				throw new ApiError(meta.errors.paymentNotFound);
			}

			let userProfile = null;
			if (payment.user) {
				userProfile = await this.userProfilesRepository.findOneBy({ userId: payment.user.id });
			}

			let stripeDetails = null;
			if (await this.stripeService.isEnabled()) {
				try {
					if (payment.stripePaymentIntentId) {
						stripeDetails = await this.stripeService.getPaymentIntent(payment.stripePaymentIntentId);
					} else if (payment.stripeCheckoutSessionId) {
						stripeDetails = await this.stripeService.getCheckoutSession(payment.stripeCheckoutSessionId);
					}
				} catch (error) {
					console.warn('Failed to fetch Stripe details:', error);
				}
			}

			return {
				id: payment.id,
				paymentIntentId: payment.stripePaymentIntentId,
				checkoutSessionId: payment.stripeCheckoutSessionId,
				stripePaymentIntentId: payment.stripePaymentIntentId,
				stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
				amount: payment.amount,
				currency: payment.currency,
				status: payment.status,
				description: payment.description,
				userId: payment.userId,
				user: payment.user ? {
					id: payment.user.id,
					username: payment.user.username,
					name: payment.user.name,
					email: userProfile?.email || null,
				} : null,
				createdAt: payment.createdAt.toISOString(),
				updatedAt: payment.updatedAt.toISOString(),
				metadata: payment.metadata,
				stripeDetails,
				paymentMode: payment.stripeCheckoutSessionId ? 'checkout_session' : 'payment_intent',
				hasCheckoutSession: !!payment.stripeCheckoutSessionId,
				hasPaymentIntent: !!payment.stripePaymentIntentId,
				rawData: {
					checkoutSession: payment.metadata?.stripeCheckoutSessionRaw || null,
					paymentIntent: payment.metadata?.stripePaymentIntentRaw || null,
				},
			};
		});
	}
}
