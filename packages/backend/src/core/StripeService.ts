/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import Stripe from 'stripe';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import type { StripeCustomersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';

@Injectable()
export class StripeService implements OnModuleInit {
	private stripe: Stripe | null = null;
	private isInitialized = false;

	constructor(
		@Inject(DI.stripeCustomersRepository)
		private stripeCustomersRepository: StripeCustomersRepository,

		private metaService: MetaService,
		private idService: IdService,
	) {}

	async onModuleInit() {
		await this.initializeStripe();
	}

	@bindThis
	private async initializeStripe(): Promise<void> {
		if (this.isInitialized) return;

		const meta = await this.metaService.fetch();
		if (meta.enableStripe && meta.stripeSecretKey && meta.stripePublicKey) {
			const isSecretTest = meta.stripeSecretKey.startsWith('sk_test_');
			const isPublicTest = meta.stripePublicKey.startsWith('pk_test_');

			if (isSecretTest !== isPublicTest) {
				throw new Error('Stripe key environment mismatch: secret and public keys must both be test or live keys');
			}

			this.stripe = new Stripe(meta.stripeSecretKey, {
			});
			this.isInitialized = true;
		}
	}

	@bindThis
	public async isEnabled(): Promise<boolean> {
		const meta = await this.metaService.fetch();
		return meta.enableStripe &&
			meta.stripeSecretKey !== null &&
			meta.stripePublicKey !== null;
	}

	@bindThis
	public async isFullyConfigured(): Promise<boolean> {
		const meta = await this.metaService.fetch();
		return meta.enableStripe &&
			meta.stripeSecretKey !== null &&
			meta.stripePublicKey !== null &&
			meta.stripeWebhookSecret !== null;
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
	public async findOrCreateCustomer(params: {
		userId: string;
		email?: string;
		name?: string;
	}): Promise<Stripe.Customer> {
		try {
			const dbCustomer = await this.stripeCustomersRepository.findOneBy({ userId: params.userId });
			if (dbCustomer) {
				try {
					const stripeCustomer = await this.getStripe().customers.retrieve(dbCustomer.stripeCustomerId);
					if (stripeCustomer && !stripeCustomer.deleted) {
						return stripeCustomer as Stripe.Customer;
					}
				} catch (error) {
					console.warn('Customer exists in database but not in Stripe, will recreate:', error);
					await this.stripeCustomersRepository.delete({ id: dbCustomer.id });
				}
			}
		} catch (error) {
			console.warn('Failed to check database for existing customer:', error);
		}

		const stripe = this.getStripe();

		try {
			let hasMore = true;
			let startingAfter: string | undefined;

			while (hasMore) {
				const customers = await stripe.customers.list({
					limit: 100,
					starting_after: startingAfter,
				});

				for (const customer of customers.data) {
					if (customer.metadata?.userId === params.userId) {
						try {
							await this.stripeCustomersRepository.insert({
								id: this.idService.gen(),
								userId: params.userId,
								stripeCustomerId: customer.id,
								email: customer.email,
								name: customer.name,
								metadata: customer.metadata ? JSON.parse(JSON.stringify(customer.metadata)) : {},
								createdAt: new Date(),
								updatedAt: new Date(),
							});
						} catch (dbError) {
							console.warn('Failed to create database record for existing Stripe customer:', dbError);
						}
						return customer;
					}
				}

				hasMore = customers.has_more;
				if (hasMore && customers.data.length > 0) {
					startingAfter = customers.data[customers.data.length - 1].id;
				}
			}
		} catch (error) {
			console.warn('Failed to search existing customers:', error);
		}

		const newCustomer = await this.createCustomer({
			email: params.email,
			name: params.name,
			metadata: {
				userId: params.userId,
			},
		});

		try {
			await this.stripeCustomersRepository.insert({
				id: this.idService.gen(),
				userId: params.userId,
				stripeCustomerId: newCustomer.id,
				email: newCustomer.email,
				name: newCustomer.name,
				metadata: newCustomer.metadata ? JSON.parse(JSON.stringify(newCustomer.metadata)) : {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		} catch (error) {
			console.warn('Failed to create database record for new customer:', error);
		}

		return newCustomer;
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
				allow_redirects: 'always',
			},
			use_stripe_sdk: true,
		});
	}

	@bindThis
	public async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
		return await this.getStripe().paymentIntents.retrieve(paymentIntentId);
	}

	@bindThis
	public async updatePaymentIntent(
		paymentIntentId: string,
		params: {
			amount?: number;
			currency?: string;
			metadata?: Record<string, string>;
		},
	): Promise<Stripe.PaymentIntent> {
		return await this.getStripe().paymentIntents.update(paymentIntentId, params);
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
		paymentMethodId?: string;
		metadata?: Record<string, string>;
		trialPeriodDays?: number;
	}): Promise<Stripe.Subscription> {
		const subscriptionParams: Stripe.SubscriptionCreateParams = {
			customer: params.customerId,
			items: [{
				price: params.priceId,
			}],
			metadata: params.metadata,
			trial_period_days: params.trialPeriodDays,
		};

		if (params.paymentMethodId) {
			subscriptionParams.default_payment_method = params.paymentMethodId;
		}

		return await this.getStripe().subscriptions.create(subscriptionParams);
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
	public async getPrice(priceId: string): Promise<Stripe.Price> {
		return await this.getStripe().prices.retrieve(priceId);
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
	public async attachPaymentMethodToCustomer(
		paymentMethodId: string,
		customerId: string,
	): Promise<Stripe.PaymentMethod> {
		return await this.getStripe().paymentMethods.attach(paymentMethodId, {
			customer: customerId,
		});
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

	@bindThis
	public async createCheckoutSession(params: {
		amount: number;
		currency: string;
		customerId?: string;
		customerEmail?: string;
		metadata?: Record<string, string>;
		description?: string;
		successUrl: string;
		cancelUrl: string;
		paymentMethodConfiguration?: string;
	}): Promise<Stripe.Checkout.Session> {
		const sessionParams: Stripe.Checkout.SessionCreateParams = {
			line_items: [{
				price_data: {
					currency: params.currency,
					product_data: {
						name: params.description || 'Payment',
					},
					unit_amount: params.amount,
				},
				quantity: 1,
			}],
			mode: 'payment',
			success_url: params.successUrl,
			cancel_url: params.cancelUrl,
			metadata: params.metadata,
			automatic_tax: {
				enabled: true,
			},
			billing_address_collection: 'auto',
			customer_update: {
				address: 'auto',
			},
			adaptive_pricing: {
				enabled: true,
			},
			locale: "auto",
		};

		if (params.customerId) {
			sessionParams.customer = params.customerId;
		} else if (params.customerEmail) {
			sessionParams.customer_email = params.customerEmail;
		}

		if (params.paymentMethodConfiguration) {
			sessionParams.payment_method_configuration = params.paymentMethodConfiguration;
		} else {
			const meta = await this.metaService.fetch();
			if (meta.stripePaymentMethodConfiguration) {
				sessionParams.payment_method_configuration = meta.stripePaymentMethodConfiguration;
			}
		}

		return await this.getStripe().checkout.sessions.create(sessionParams);
	}

	@bindThis
	public async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
		return await this.getStripe().checkout.sessions.retrieve(sessionId);
	}

	@bindThis
	public async createEmbeddedCheckoutSession(params: {
		amount: number;
		currency: string;
		customerId?: string;
		customerEmail?: string;
		metadata?: Record<string, string>;
		description?: string;
		returnUrl: string;
		paymentMethodConfiguration?: string;
	}): Promise<Stripe.Checkout.Session> {
		const sessionParams: Stripe.Checkout.SessionCreateParams = {
			line_items: [{
				price_data: {
					currency: params.currency,
					product_data: {
						name: params.description || 'Payment',
					},
					unit_amount: params.amount,
				},
				quantity: 1,
			}],
			mode: 'payment',
			ui_mode: 'embedded',
			return_url: params.returnUrl,
			metadata: params.metadata,
			automatic_tax: {
				enabled: true,
			},
			billing_address_collection: 'auto',
			customer_update: {
				address: 'auto',
			},
			adaptive_pricing: {
				enabled: true,
			},
			locale: "auto",
		};

		if (params.customerId) {
			sessionParams.customer = params.customerId;
		} else if (params.customerEmail) {
			sessionParams.customer_email = params.customerEmail;
		}

		if (params.paymentMethodConfiguration) {
			sessionParams.payment_method_configuration = params.paymentMethodConfiguration;
		} else {
			const meta = await this.metaService.fetch();
			if (meta.stripePaymentMethodConfiguration) {
				sessionParams.payment_method_configuration = meta.stripePaymentMethodConfiguration;
			}
		}

		return await this.getStripe().checkout.sessions.create(sessionParams);
	}
}
