/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';
import { ApiError } from '../../error.js';
import type { StripePaymentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';

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
		paymentMethodRequired: {
			message: 'Payment method is required to confirm this payment intent.',
			code: 'PAYMENT_METHOD_REQUIRED',
			id: 'd4e5f6a7-b8c9-0123-4567-890123def456',
		},
		confirmationFailed: {
			message: 'Failed to confirm payment intent.',
			code: 'PAYMENT_CONFIRMATION_FAILED',
			id: 'e5f6a7b8-c9d0-1234-5678-901234ef5678',
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
		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,

		private stripeService: StripeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.stripeService.isEnabled()) {
				throw new ApiError(meta.errors.stripeNotEnabled);
			}

			try {
				const dbPayment = await this.stripePaymentsRepository.findOneBy({
					stripePaymentIntentId: ps.paymentIntentId,
				});

				if (!dbPayment) {
					throw new ApiError(meta.errors.paymentIntentNotFound);
				}

				let paymentIntent = await this.stripeService.getPaymentIntent(ps.paymentIntentId);

				if (['succeeded', 'processing', 'requires_action'].includes(paymentIntent.status)) {
				} else if (paymentIntent.status === 'requires_confirmation' ||
					(paymentIntent.status === 'requires_payment_method' && ps.paymentMethodId)) {
					const confirmParams: any = {};
					if (ps.paymentMethodId) {
						confirmParams.payment_method = ps.paymentMethodId;
					}

					try {
						paymentIntent = await this.stripeService.confirmPaymentIntent(
							ps.paymentIntentId,
							confirmParams,
						);
					} catch (confirmError) {
						paymentIntent = await this.stripeService.getPaymentIntent(ps.paymentIntentId);

						if (paymentIntent.status === 'requires_payment_method' && !ps.paymentMethodId) {
							throw new ApiError(meta.errors.paymentMethodRequired);
						}
					}
				} else if (paymentIntent.status === 'requires_payment_method' && !ps.paymentMethodId) {
					throw new ApiError(meta.errors.paymentMethodRequired);
				}

				const updateData: any = {
					status: paymentIntent.status,
					metadata: paymentIntent.metadata ? JSON.parse(JSON.stringify(paymentIntent.metadata)) : {},
					updatedAt: new Date(),
				};

				if (paymentIntent.payment_method) {
					const paymentMethod = paymentIntent.payment_method;
					if (typeof paymentMethod === 'object' && paymentMethod.type) {
						updateData.metadata.paymentMethod = {
							type: paymentMethod.type,
							id: paymentMethod.id,
						};
					} else if (typeof paymentMethod === 'string') {
						updateData.metadata.paymentMethodId = paymentMethod;
					}
				}

				const paymentData = paymentIntent as any;
				if (paymentData.charges && paymentData.charges.data && paymentData.charges.data.length > 0) {
					const charge = paymentData.charges.data[0];
					if (charge.outcome) {
						updateData.stripeRiskLevel = charge.outcome.risk_level || null;
						updateData.stripeRiskScore = charge.outcome.risk_score || null;
					}

					if (charge.payment_method_details) {
						updateData.metadata.paymentMethodDetails = charge.payment_method_details;
					}
				}

				await this.stripePaymentsRepository.update(dbPayment.id, updateData);

				return {
					status: paymentIntent.status,
					paymentIntentId: paymentIntent.id,
				};
			} catch (error) {
				if (error instanceof ApiError) {
					throw error;
				}

				if (error && typeof error === 'object' && 'code' in error) {
					switch (error.code) {
						case 'resource_missing':
						case 'payment_intent_not_found':
							throw new ApiError(meta.errors.paymentIntentNotFound);
						case 'payment_method_required':
							throw new ApiError(meta.errors.paymentMethodRequired);
						default:
							console.error('Failed to confirm payment intent:', error);
							throw new ApiError(meta.errors.confirmationFailed);
					}
				}

				console.error('Failed to confirm payment intent:', error);
				throw new ApiError(meta.errors.confirmationFailed);
			}
		});
	}
}
