/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { StripeService } from './StripeService.js';
import { StripeSubscriptionService } from './StripeSubscriptionService.js';
import MisskeyLogger from '@/logger.js';

@Injectable()
export class StripeWebhookService {
	private logger = new MisskeyLogger('stripe-webhook');

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private stripeService: StripeService,
		private stripeSubscriptionService: StripeSubscriptionService,
	) {}

	@bindThis
	public async processWebhook(payload: string | Buffer, signature: string): Promise<void> {
		try {
			const event = await this.stripeService.constructWebhookEvent(payload, signature);

			this.logger.info(`Processing Stripe webhook event: ${event.type}`);

			switch (event.type) {
				case 'customer.subscription.created':
				case 'customer.subscription.updated':
				case 'customer.subscription.deleted':
					await this.handleSubscriptionEvent(event);
					break;

				case 'invoice.payment_succeeded':
				case 'invoice.payment_failed':
				case 'invoice.payment_action_required':
					await this.handleInvoiceEvent(event);
					break;

				case 'payment_intent.succeeded':
				case 'payment_intent.payment_failed':
				case 'payment_intent.canceled':
				case 'payment_intent.processing':
				case 'payment_intent.requires_action':
					await this.handlePaymentIntentEvent(event);
					break;

				case 'setup_intent.succeeded':
				case 'setup_intent.setup_failed':
				case 'setup_intent.canceled':
					await this.handleSetupIntentEvent(event);
					break;

				case 'customer.created':
				case 'customer.updated':
				case 'customer.deleted':
					await this.handleCustomerEvent(event);
					break;

				case 'charge.dispute.created':
					await this.handleDisputeEvent(event);
					break;

				default:
					this.logger.info(`Unhandled webhook event type: ${event.type}`);
					break;
			}

			this.logger.info(`Successfully processed webhook event: ${event.type}`);
		} catch (error) {
			this.logger.error('Failed to process Stripe webhook', (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handleSubscriptionEvent(event: any): Promise<void> {
		const subscription = event.data.object;

		this.logger.info(`Processing subscription event: ${event.type} for ${subscription.id}`);

		try {
			await this.stripeSubscriptionService.updateSubscriptionFromWebhook(subscription);

			switch (event.type) {
				case 'customer.subscription.created':
					this.logger.info(`New subscription created: ${subscription.id}`);
					break;

				case 'customer.subscription.deleted':
					this.logger.info(`Subscription canceled: ${subscription.id}`);
					break;

				case 'customer.subscription.updated':
					if (subscription.cancel_at_period_end) {
						this.logger.info(`Subscription scheduled for cancellation: ${subscription.id}`);
					}
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process subscription event for ${subscription.id}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handleInvoiceEvent(event: any): Promise<void> {
		const invoice = event.data.object;

		this.logger.info(`Processing invoice event: ${event.type} for ${invoice.id}`);

		try {
			switch (event.type) {
				case 'invoice.payment_succeeded':
					this.logger.info(`Payment succeeded for invoice: ${invoice.id}`);

					if (invoice.subscription) {
						const subscription = await this.stripeService.getSubscription(invoice.subscription);
						await this.stripeSubscriptionService.updateSubscriptionFromWebhook(subscription);
					}
					break;

				case 'invoice.payment_failed':
					this.logger.warn(`Payment failed for invoice: ${invoice.id}`);
					break;

				case 'invoice.payment_action_required':
					this.logger.info(`Payment action required for invoice: ${invoice.id}`);
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process invoice event for ${invoice.id}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handlePaymentIntentEvent(event: any): Promise<void> {
		const paymentIntent = event.data.object;

		this.logger.info(`Processing payment intent event: ${event.type} for ${paymentIntent.id}`);

		try {
			await this.stripeSubscriptionService.updatePaymentFromWebhook(paymentIntent);

			switch (event.type) {
				case 'payment_intent.succeeded':
					this.logger.info(`Payment intent succeeded: ${paymentIntent.id}`);
					break;

				case 'payment_intent.payment_failed':
					this.logger.warn(`Payment intent failed: ${paymentIntent.id}`);
					break;

				case 'payment_intent.canceled':
					this.logger.info(`Payment intent canceled: ${paymentIntent.id}`);
					break;

				case 'payment_intent.processing':
					this.logger.info(`Payment intent processing: ${paymentIntent.id} (${paymentIntent.payment_method_types?.join(', ')})`);
					break;

				case 'payment_intent.requires_action':
					this.logger.info(`Payment intent requires action: ${paymentIntent.id}`);
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process payment intent event for ${paymentIntent.id}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handleSetupIntentEvent(event: any): Promise<void> {
		const setupIntent = event.data.object;

		this.logger.info(`Processing setup intent event: ${event.type} for ${setupIntent.id}`);

		try {
			switch (event.type) {
				case 'setup_intent.succeeded':
					this.logger.info(`Setup intent succeeded: ${setupIntent.id}`);
					if (setupIntent.metadata?.subscriptionId) {
						this.logger.info(`Setup intent ${setupIntent.id} linked to subscription ${setupIntent.metadata.subscriptionId}`);
					}
					break;

				case 'setup_intent.setup_failed':
					this.logger.warn(`Setup intent failed: ${setupIntent.id}`);
					break;

				case 'setup_intent.canceled':
					this.logger.info(`Setup intent canceled: ${setupIntent.id}`);
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process setup intent event for ${setupIntent.id}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handleCustomerEvent(event: any): Promise<void> {
		const customer = event.data.object;

		this.logger.info(`Processing customer event: ${event.type} for ${customer.id}`);

		try {
			switch (event.type) {
				case 'customer.created':
					this.logger.info(`New customer created: ${customer.id}`);
					break;

				case 'customer.updated':
					this.logger.info(`Customer updated: ${customer.id}`);
					break;

				case 'customer.deleted':
					this.logger.info(`Customer deleted: ${customer.id}`);
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process customer event for ${customer.id}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	private async handleDisputeEvent(event: any): Promise<void> {
		const dispute = event.data.object;

		this.logger.warn(`Processing dispute event: ${event.type} for charge ${dispute.charge}`);

		try {
			switch (event.type) {
				case 'charge.dispute.created':
					this.logger.warn(`New dispute created for charge: ${dispute.charge}`);
					break;
			}
		} catch (error) {
			this.logger.error(`Failed to process dispute event for charge ${dispute.charge}`, (error as Error));
			throw error;
		}
	}

	@bindThis
	public isWebhookConfigured(): boolean {
		return Boolean(this.meta.stripeWebhookSecret);
	}

	@bindThis
	public async validateWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean> {
		try {
			await this.stripeService.constructWebhookEvent(payload, signature);
			return true;
		} catch (error) {
			this.logger.warn('Invalid webhook signature', (error as Error));
			return false;
		}
	}
}
