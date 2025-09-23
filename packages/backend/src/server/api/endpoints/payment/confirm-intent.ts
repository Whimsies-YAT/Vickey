/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['payment'],

	requireCredential: true,
	secure: true,

	res: {
		type: 'object',
		properties: {
			status: {
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
		paymentIntentNotFound: {
			message: 'Payment intent not found.',
			code: 'PAYMENT_INTENT_NOT_FOUND',
			id: 'c3d4e5f6-a7b8-9012-3456-789012cdef01',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		paymentIntentId: { type: 'string' },
		paymentMethodId: { type: 'string', nullable: true },
	},
	required: ['paymentIntentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private stripeService: StripeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.stripeService.isEnabled()) {
				throw new ApiError(meta.errors.stripeNotEnabled);
			}

			try {
				const confirmParams: any = {};
				if (ps.paymentMethodId) {
					confirmParams.payment_method = ps.paymentMethodId;
				}

				const paymentIntent = await this.stripeService.confirmPaymentIntent(
					ps.paymentIntentId,
					confirmParams,
				);

				return {
					status: paymentIntent.status,
					paymentIntentId: paymentIntent.id,
				};
			} catch (error) {
				throw new ApiError(meta.errors.paymentIntentNotFound);
			}
		});
	}
}
