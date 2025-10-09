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
			subscriptionId: {
				type: 'string',
			},
			status: {
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
		subscriptionNotFound: {
			message: 'Subscription not found.',
			code: 'SUBSCRIPTION_NOT_FOUND',
			id: 'e5f6a7b8-c9d0-1234-5678-901234efab56',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		subscriptionId: { type: 'string' },
		cancelAtPeriodEnd: { type: 'boolean', default: true },
	},
	required: ['subscriptionId'],
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
				const subscription = await this.stripeService.cancelSubscription(
					ps.subscriptionId,
					ps.cancelAtPeriodEnd,
				);

				return {
					subscriptionId: subscription.id,
					status: subscription.status,
				};
			} catch (error) {
				throw new ApiError(meta.errors.subscriptionNotFound);
			}
		});
	}
}
