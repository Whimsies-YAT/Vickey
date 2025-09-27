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
				nullable: true,
			},
			checkoutSessionId: {
				type: 'string',
				nullable: true,
			},
			amount: {
				type: 'number',
			},
			currency: {
				type: 'string',
			},
			description: {
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
		paymentNotFound: {
			message: 'Payment intent or checkout session not found.',
			code: 'PAYMENT_NOT_FOUND',
			id: 'c3d4e5f6-a7b8-9012-3456-789012cdef01',
		},
		paymentMethodRequired: {
			message: 'Payment method is required to confirm this payment intent.',
			code: 'PAYMENT_METHOD_REQUIRED',
			id: 'd4e5f6a7-b8c9-0123-4567-890123def456',
		},
		confirmationFailed: {
			message: 'Failed to confirm payment.',
			code: 'PAYMENT_CONFIRMATION_FAILED',
			id: 'e5f6a7b8-c9d0-1234-5678-901234ef5678',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		paymentIntentId: { type: 'string', nullable: true },
		checkoutSessionId: { type: 'string', nullable: true },
		paymentMethodId: { type: 'string', nullable: true },
	},
	anyOf: [
		{ required: ['paymentIntentId'] },
		{ required: ['checkoutSessionId'] },
	],
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
				let dbPayment;
				let isCheckoutSession = false;

				if (ps.checkoutSessionId) {
					dbPayment = await this.stripePaymentsRepository.findOneBy({
						stripeCheckoutSessionId: ps.checkoutSessionId,
					});
					isCheckoutSession = true;
				} else if (ps.paymentIntentId) {
					dbPayment = await this.stripePaymentsRepository.findOneBy({
						stripePaymentIntentId: ps.paymentIntentId,
					});
				}

				if (!dbPayment) {
					throw new ApiError(meta.errors.paymentNotFound);
				}

				let status: string;
				let paymentIntentId: string | null = null;
				let checkoutSessionId: string | null = null;
				const updateData: any = {
					updatedAt: new Date(),
				};

				if (isCheckoutSession && ps.checkoutSessionId) {
					const checkoutSession = await this.stripeService.getCheckoutSession(ps.checkoutSessionId);

					checkoutSessionId = checkoutSession.id;
					updateData.metadata = checkoutSession.metadata ? JSON.parse(JSON.stringify(checkoutSession.metadata)) : {};

					updateData.metadata.stripeCheckoutSessionRaw = JSON.parse(JSON.stringify(checkoutSession));

					if (checkoutSession.payment_status === 'unpaid') {
						status = 'requires_payment_method';
						updateData.status = status;
					} else if (checkoutSession.payment_intent) {
						let actualPaymentIntent;

						if (typeof checkoutSession.payment_intent === 'string') {
							actualPaymentIntent = await this.stripeService.getPaymentIntent(checkoutSession.payment_intent);
							updateData.stripePaymentIntentId = checkoutSession.payment_intent;
							paymentIntentId = checkoutSession.payment_intent;
						} else {
							actualPaymentIntent = checkoutSession.payment_intent;
							updateData.stripePaymentIntentId = actualPaymentIntent.id;
							paymentIntentId = actualPaymentIntent.id;
						}

						status = actualPaymentIntent.status;
						updateData.status = status;

						updateData.metadata.stripePaymentIntentRaw = JSON.parse(JSON.stringify(actualPaymentIntent));

						if (actualPaymentIntent.payment_method) {
							const paymentMethod = actualPaymentIntent.payment_method;
							if (typeof paymentMethod === 'object' && paymentMethod.type) {
								updateData.metadata.paymentMethod = {
									type: paymentMethod.type,
									id: paymentMethod.id,
								};
							} else if (typeof paymentMethod === 'string') {
								updateData.metadata.paymentMethodId = paymentMethod;
							}
						}

						if (actualPaymentIntent.metadata) {
							updateData.metadata = { ...updateData.metadata, ...actualPaymentIntent.metadata };
						}

						const paymentData = actualPaymentIntent as any;
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
					} else {
						status = checkoutSession.payment_status === 'paid' ? 'succeeded' :
						  checkoutSession.payment_status === 'no_payment_required' ? 'succeeded' :
							checkoutSession.payment_status === 'unpaid' ? 'requires_payment_method' :
							checkoutSession.status as any;
						updateData.status = status;
					}

					if (checkoutSession.customer_details) {
						updateData.metadata.customerDetails = checkoutSession.customer_details;
					}
				} else if (ps.paymentIntentId) {
					let paymentIntent = await this.stripeService.getPaymentIntent(ps.paymentIntentId);

					if (paymentIntent.status === 'requires_confirmation' ||
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

					status = paymentIntent.status;
					paymentIntentId = paymentIntent.id;
					updateData.status = status;
					updateData.metadata = paymentIntent.metadata ? JSON.parse(JSON.stringify(paymentIntent.metadata)) : {};

					updateData.metadata.stripePaymentIntentRaw = JSON.parse(JSON.stringify(paymentIntent));

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
				} else {
					throw new ApiError(meta.errors.paymentNotFound);
				}

				await this.stripePaymentsRepository.update(dbPayment.id, updateData);

				return {
					status: status!,
					paymentIntentId,
					checkoutSessionId,
					amount: dbPayment.amount,
					currency: dbPayment.currency,
					description: dbPayment.description,
				};
			} catch (error) {
				if (error instanceof ApiError) {
					throw error;
				}

				if (error && typeof error === 'object' && 'code' in error) {
					switch (error.code) {
						case 'resource_missing':
						case 'payment_intent_not_found':
						case 'checkout_session_not_found':
							throw new ApiError(meta.errors.paymentNotFound);
						case 'payment_method_required':
							throw new ApiError(meta.errors.paymentMethodRequired);
						default:
							console.error('Failed to confirm payment:', error);
							throw new ApiError(meta.errors.confirmationFailed);
					}
				}

				console.error('Failed to confirm payment:', error);
				throw new ApiError(meta.errors.confirmationFailed);
			}
		});
	}
}
