/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import fastify_1 from 'fastify';
import type { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { StripeWebhookService } from '@/core/StripeWebhookService.js';
import MisskeyLogger from '@/logger.js';

@Injectable()
export class StripeWebhookServerService {
	private logger = new MisskeyLogger('stripe-webhook-server');

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,
		private stripeWebhookService: StripeWebhookService,
	) {
	}

	@bindThis
	public createServer(fastify: fastify_1.FastifyInstance, options: any, done: (err?: Error) => void): void {
		fastify.addContentTypeParser('application/json', {parseAs: 'buffer'}, function (req, body, done) {
			done(null, body);
		});

		fastify.post('/stripe/webhook', {
			config: {
				rawBody: true,
			},
		}, async (request: fastify_1.FastifyRequest, reply: fastify_1.FastifyReply) => {
			try {
				if (!this.meta.enableStripe || !this.stripeWebhookService.isWebhookConfigured()) {
					this.logger.warn('Stripe webhook received but Stripe is not configured');
					return reply.code(400).send({ error: 'Stripe not configured' });
				}

				const signature = request.headers['stripe-signature'];
				if (!signature || typeof signature !== 'string') {
					this.logger.warn('Missing Stripe signature header');
					return reply.code(400).send({ error: 'Missing signature' });
				}

				const payload = request.body as Buffer;
				if (!payload) {
					this.logger.warn('Empty webhook payload');
					return reply.code(400).send({ error: 'Empty payload' });
				}

				const isValid = await this.stripeWebhookService.validateWebhookSignature(payload, signature);
				if (!isValid) {
					this.logger.warn('Invalid Stripe webhook signature');
					return reply.code(400).send({ error: 'Invalid signature' });
				}

				await this.stripeWebhookService.processWebhook(payload, signature);

				this.logger.info('Successfully processed Stripe webhook');
				return reply.code(200).send({ received: true });
			} catch (error) {
				this.logger.error('Failed to process Stripe webhook', error as Error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		});

		done();
	}
}
