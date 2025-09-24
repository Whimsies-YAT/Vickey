/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type {
	StripeCustomersRepository,
	StripePaymentsRepository,
	StripeSubscriptionsRepository,
	UsersRepository,
	UserProfilesRepository,
} from '@/models/_.js';
import type { MiUser } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { StripeService } from '@/core/StripeService.js';
import { IdService } from '@/core/IdService.js';

@Injectable()
export class StripeSubscriptionService {
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.stripeCustomersRepository)
		private stripeCustomersRepository: StripeCustomersRepository,

		@Inject(DI.stripePaymentsRepository)
		private stripePaymentsRepository: StripePaymentsRepository,

		@Inject(DI.stripeSubscriptionsRepository)
		private stripeSubscriptionsRepository: StripeSubscriptionsRepository,

		private stripeService: StripeService,
		private idService: IdService,
	) {}

	@bindThis
	public async getOrCreateStripeCustomer(user: MiUser): Promise<string> {
		const stripeCustomer = await this.stripeCustomersRepository.findOneBy({
			userId: user.id,
		});

		if (stripeCustomer) {
			return stripeCustomer.stripeCustomerId;
		}

		const userProfile = await this.userProfilesRepository.findOneBy({
			userId: user.id,
		});

		const customer = await this.stripeService.createCustomer({
			email: userProfile?.email || undefined,
			name: user.name || undefined,
			metadata: {
				userId: user.id,
				username: user.username,
			},
		});

		await this.stripeCustomersRepository.insert({
			id: this.idService.gen(),
			userId: user.id,
			stripeCustomerId: customer.id,
			email: customer.email || null,
			name: customer.name || null,
			metadata: customer.metadata ? JSON.parse(JSON.stringify(customer.metadata)) : {},
		});

		return customer.id;
	}

	@bindThis
	public async createSubscription(params: {
		userId: string;
		priceId: string;
		trialPeriodDays?: number;
		metadata?: Record<string, string>;
		requirePaymentConfirmation?: boolean;
		paymentBehavior?: 'default_incomplete' | 'allow_incomplete' | 'error_if_incomplete';
		subscriptionReason?: string;
		adminNotes?: string;
	}): Promise<{
		subscriptionId: string;
		clientSecret?: string;
		status: string;
		requiresAction: boolean;
		pendingSetupIntent?: string;
	}> {
		const user = await this.usersRepository.findOneByOrFail({ id: params.userId });
		const customerId = await this.getOrCreateStripeCustomer(user);

		const subscription = await this.stripeService.createSubscription({
			customerId,
			priceId: params.priceId,
			trialPeriodDays: params.trialPeriodDays,
			metadata: {
				userId: params.userId,
				...params.metadata,
			},
		});

		await this.stripeSubscriptionsRepository.insert({
			id: this.idService.gen(),
			userId: params.userId,
			stripeSubscriptionId: subscription.id,
			stripeCustomerId: customerId,
			stripePriceId: params.priceId,
			stripeProductId: typeof subscription.items.data[0].price.product === 'string'
				? subscription.items.data[0].price.product
				: subscription.items.data[0].price.product?.id ?? null,
			status: subscription.status,
			currentPeriodStart: new Date(subscription.items.data[0].current_period_start * 1000),
			currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
			endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : null,
			trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
			trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
			subscriptionReason: params.subscriptionReason || null,
			adminNotes: params.adminNotes || null,
			metadata: subscription.metadata ? JSON.parse(JSON.stringify(subscription.metadata)) : {},
		});

		let clientSecret: string | undefined = undefined;
		let pendingSetupIntent: string | undefined = undefined;
		let requiresAction = false;

		switch (subscription.status) {
			case 'incomplete':
				requiresAction = true;
				if (params.requirePaymentConfirmation) {
					try {
						const setupIntent = await this.stripeService.createSetupIntent({
							customerId,
							usage: 'off_session',
							metadata: {
								subscriptionId: subscription.id,
								userId: params.userId,
							},
						});
						clientSecret = setupIntent.client_secret || undefined;
						pendingSetupIntent = setupIntent.id;
					} catch (error) {
						console.warn('Could not create setup intent for incomplete subscription:', error);
					}
				}
				break;

			case 'incomplete_expired':
				requiresAction = true;
				break;

			case 'active':
			case 'trialing':
				requiresAction = false;
				break;

			case 'past_due':
				requiresAction = false;
				break;

			default:
				requiresAction = false;
		}

		return {
			subscriptionId: subscription.id,
			clientSecret,
			status: subscription.status,
			requiresAction,
			pendingSetupIntent,
		};
	}

	@bindThis
	public async cancelSubscription(params: {
		userId: string;
		subscriptionId: string;
		cancelAtPeriodEnd?: boolean;
	}): Promise<void> {
		const dbSubscription = await this.stripeSubscriptionsRepository.findOneBy({
			stripeSubscriptionId: params.subscriptionId,
			userId: params.userId,
		});

		if (!dbSubscription) {
			throw new Error('Subscription not found or access denied');
		}

		const subscription = await this.stripeService.cancelSubscription(
			params.subscriptionId,
			params.cancelAtPeriodEnd ?? false,
		);

		await this.stripeSubscriptionsRepository.update(dbSubscription.id, {
			status: subscription.status,
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
			endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : null,
			updatedAt: new Date(),
		});
	}

	@bindThis
	public async getUserSubscriptions(userId: string) {
		return await this.stripeSubscriptionsRepository.findBy({
			userId,
		});
	}

	@bindThis
	public async getActiveUserSubscriptions(userId: string) {
		return await this.stripeSubscriptionsRepository.findBy({
			userId,
			status: 'active',
		});
	}

	@bindThis
	public async createPaymentIntent(params: {
		userId: string;
		amount: number;
		currency: string;
		description?: string;
		metadata?: Record<string, string>;
		paymentReason?: string;
		adminNotes?: string;
	}): Promise<{ paymentIntentId: string; clientSecret: string }> {
		const user = await this.usersRepository.findOneByOrFail({ id: params.userId });
		const customerId = await this.getOrCreateStripeCustomer(user);

		const paymentIntent = await this.stripeService.createPaymentIntent({
			amount: params.amount,
			currency: params.currency,
			customerId,
			description: params.description,
			metadata: {
				userId: params.userId,
				...params.metadata,
			},
		});

		await this.stripePaymentsRepository.insert({
			id: this.idService.gen(),
			userId: params.userId,
			stripePaymentIntentId: paymentIntent.id,
			stripeCustomerId: customerId,
			amount: params.amount,
			currency: params.currency,
			status: paymentIntent.status,
			description: params.description,
			paymentReason: params.paymentReason || null,
			adminNotes: params.adminNotes || null,
			metadata: paymentIntent.metadata ? JSON.parse(JSON.stringify(paymentIntent.metadata)) : {},
		});

		return {
			paymentIntentId: paymentIntent.id,
			clientSecret: paymentIntent.client_secret!,
		};
	}

	@bindThis
	public async createBillingPortalSession(params: {
		userId: string;
		returnUrl: string;
	}): Promise<{ url: string }> {
		const user = await this.usersRepository.findOneByOrFail({ id: params.userId });
		const customerId = await this.getOrCreateStripeCustomer(user);

		const session = await this.stripeService.createPortalSession({
			customerId,
			returnUrl: params.returnUrl,
		});

		return {
			url: session.url,
		};
	}

	@bindThis
	public async updateSubscriptionFromWebhook(subscriptionData: any): Promise<void> {
		const dbSubscription = await this.stripeSubscriptionsRepository.findOneBy({
			stripeSubscriptionId: subscriptionData.id,
		});

		if (!dbSubscription) {
			return;
		}

		await this.stripeSubscriptionsRepository.update(dbSubscription.id, {
			status: subscriptionData.status,
			currentPeriodStart: new Date(subscriptionData.items.data[0].current_period_start * 1000),
			currentPeriodEnd: new Date(subscriptionData.items.data[0].current_period_end * 1000),
			cancelAtPeriodEnd: subscriptionData.cancel_at_period_end,
			canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
			endedAt: subscriptionData.ended_at ? new Date(subscriptionData.ended_at * 1000) : null,
			trialStart: subscriptionData.trial_start ? new Date(subscriptionData.trial_start * 1000) : null,
			trialEnd: subscriptionData.trial_end ? new Date(subscriptionData.trial_end * 1000) : null,
			metadata: subscriptionData.metadata,
			updatedAt: new Date(),
		});
	}

	@bindThis
	public async updatePaymentFromWebhook(paymentIntentData: any): Promise<void> {
		const dbPayment = await this.stripePaymentsRepository.findOneBy({
			stripePaymentIntentId: paymentIntentData.id,
		});

		if (!dbPayment) {
			return;
		}

		const updateData: any = {
			status: paymentIntentData.status,
			metadata: paymentIntentData.metadata,
			updatedAt: new Date(),
		};

		if (paymentIntentData.charges && paymentIntentData.charges.data.length > 0) {
			const charge = paymentIntentData.charges.data[0];
			if (charge.outcome) {
				updateData.stripeRiskLevel = charge.outcome.risk_level || null;
				updateData.stripeRiskScore = charge.outcome.risk_score || null;
			}
		}

		await this.stripePaymentsRepository.update(dbPayment.id, updateData);
	}
}
