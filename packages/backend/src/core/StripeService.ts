/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';

@Injectable()
export class StripeService implements OnModuleInit {
	private stripe: Stripe | null = null;
	private isInitialized = false;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private metaService: MetaService,
	) {}

	async onModuleInit() {
		await this.initializeStripe();
	}

	@bindThis
	private async initializeStripe(): Promise<void> {
		if (this.isInitialized) return;

		const meta = await this.metaService.fetch();
		if (meta.enableStripe && meta.stripeSecretKey) {
			this.stripe = new Stripe(meta.stripeSecretKey, {
			});
			this.isInitialized = true;
		}
	}

	@bindThis
	public async isEnabled(): Promise<boolean> {
		const meta = await this.metaService.fetch();
		return meta.enableStripe && meta.stripeSecretKey !== null;
	}

	@bindThis
	public async getPublicKey(): Promise<string | null> {
		const meta = await this.metaService.fetch();
		return meta.stripePublicKey;
	}

	@bindThis
	private getStripe(): Stripe {
		if (!this.stripe) {
			throw new Error('Stripe is not enabled or properly configured');
		}
		return this.stripe;
	}

	@bindThis
	public async createCustomer(params: {
		email?: string;
		name?: string;
		metadata?: Record<string, string>;
	}): Promise<Stripe.Customer> {
		return await this.getStripe().customers.create(params);
	}

	@bindThis
	public async getCustomer(customerId: string): Promise<Stripe.Customer> {
		return await this.getStripe().customers.retrieve(customerId) as Stripe.Customer;
	}

	@bindThis
	public async updateCustomer(
		customerId: string,
		params: Stripe.CustomerUpdateParams,
	): Promise<Stripe.Customer> {
		return await this.getStripe().customers.update(customerId, params);
	}

	@bindThis
	public async createPaymentIntent(params: {
		amount: number;
		currency: string;
		customerId?: string;
		metadata?: Record<string, string>;
		description?: string;
	}): Promise<Stripe.PaymentIntent> {
		return await this.getStripe().paymentIntents.create({
			amount: params.amount,
			currency: params.currency,
			customer: params.customerId,
			metadata: params.metadata,
			description: params.description,
			automatic_payment_methods: {
				enabled: true,
			},
		});
	}

	@bindThis
	public async confirmPaymentIntent(
		paymentIntentId: string,
		params?: Stripe.PaymentIntentConfirmParams,
	): Promise<Stripe.PaymentIntent> {
		return await this.getStripe().paymentIntents.confirm(paymentIntentId, params);
	}

	@bindThis
	public async createSubscription(params: {
		customerId: string;
		priceId: string;
		metadata?: Record<string, string>;
		trialPeriodDays?: number;
	}): Promise<Stripe.Subscription> {
		return await this.getStripe().subscriptions.create({
			customer: params.customerId,
			items: [{
				price: params.priceId,
			}],
			metadata: params.metadata,
			trial_period_days: params.trialPeriodDays,
		});
	}

	@bindThis
	public async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
		return await this.getStripe().subscriptions.retrieve(subscriptionId);
	}

	@bindThis
	public async updateSubscription(
		subscriptionId: string,
		params: Stripe.SubscriptionUpdateParams,
	): Promise<Stripe.Subscription> {
		return await this.getStripe().subscriptions.update(subscriptionId, params);
	}

	@bindThis
	public async cancelSubscription(
		subscriptionId: string,
		cancelAtPeriodEnd: boolean = false,
	): Promise<Stripe.Subscription> {
		const stripe = this.getStripe();
		if (cancelAtPeriodEnd) {
			return await stripe.subscriptions.update(subscriptionId, {
				cancel_at_period_end: true,
			});
		} else {
			return await stripe.subscriptions.cancel(subscriptionId);
		}
	}

	@bindThis
	public async createPrice(params: {
		productId: string;
		unitAmount: number;
		currency: string;
		recurring?: {
			interval: 'day' | 'week' | 'month' | 'year';
			intervalCount?: number;
		};
		metadata?: Record<string, string>;
	}): Promise<Stripe.Price> {
		return await this.getStripe().prices.create({
			product: params.productId,
			unit_amount: params.unitAmount,
			currency: params.currency,
			recurring: params.recurring,
			metadata: params.metadata,
		});
	}

	@bindThis
	public async createProduct(params: {
		name: string;
		description?: string;
		metadata?: Record<string, string>;
	}): Promise<Stripe.Product> {
		return await this.getStripe().products.create(params);
	}

	@bindThis
	public async constructWebhookEvent(
		payload: string | Buffer,
		signature: string,
	): Promise<Stripe.Event> {
		const meta = await this.metaService.fetch();
		if (!meta.stripeWebhookSecret) {
			throw new Error('Stripe webhook secret is not configured');
		}
		return this.getStripe().webhooks.constructEvent(
			payload,
			signature,
			meta.stripeWebhookSecret,
		);
	}

	@bindThis
	public async listCustomerPaymentMethods(
		customerId: string,
		type?: string,
	): Promise<Stripe.PaymentMethod[]> {
		const paymentMethods = await this.getStripe().paymentMethods.list({
			customer: customerId,
			type: type as Stripe.PaymentMethodListParams.Type || 'card',
		});
		return paymentMethods.data;
	}

	@bindThis
	public async createPortalSession(params: {
		customerId: string;
		returnUrl: string;
	}): Promise<Stripe.BillingPortal.Session> {
		return await this.getStripe().billingPortal.sessions.create({
			customer: params.customerId,
			return_url: params.returnUrl,
		});
	}

	@bindThis
	public async createSetupIntent(params: {
		customerId: string;
		usage: 'on_session' | 'off_session';
		metadata?: Record<string, string>;
	}): Promise<Stripe.SetupIntent> {
		return await this.getStripe().setupIntents.create({
			customer: params.customerId,
			usage: params.usage,
			metadata: params.metadata,
			automatic_payment_methods: {
				enabled: true,
			},
		});
	}
}
