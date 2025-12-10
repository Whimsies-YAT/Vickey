/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { OAuthClientManager } from '@/server/oauth/client/OAuthClientManager.js';
import { SSOService } from '@/server/oauth/client/SSOService.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

@Injectable()
export class SsoServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,
		private oauthClientManager: OAuthClientManager,
		private ssoService: SSOService,
		private authenticateService: AuthenticateService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('sso-server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		// Initialize login flow
		fastify.get<{
			Params: { providerId: string };
		}>('/sso/connect/:providerId', async (request, reply) => {
			const providerId = request.params.providerId;

			try {
				const { authUrl } = await this.ssoService.initializeLogin(providerId);
				return await reply.redirect(authUrl);
			} catch (error) {
				const msg = error instanceof Error ? error.message : 'Failed to initialize login';
				this.logger.error('Failed to initialize login', { error });
				reply.code(400);
				return { error: msg };
			}
		});

		fastify.post<{
			Params: { providerId: string };
			Body: { token: string };
		}>('/sso/connect/:providerId', async (request, reply) => {
			const providerId = request.params.providerId;
			const { token } = request.body;

			let userId: string | undefined;

			if (token) {
				try {
					const authResult = await this.authenticateService.authenticate(token);
					if (authResult.user) {
						userId = authResult.user.id;
					}
				} catch (e) {
					// Ignore invalid tokens
				}
			}

			try {
				const { authUrl } = await this.ssoService.initializeLogin(providerId, userId);
				return { url: authUrl };
			} catch (error) {
				const msg = error instanceof Error ? error.message : 'Failed to initialize login';
				this.logger.error('Failed to initialize login', { error });
				reply.code(400);
				return { error: msg };
			}
		});

		// Callback handler
		fastify.get<{
			Querystring: { code: string; state: string; error?: string };
		}>('/sso/callback', async (request, reply) => {
			const { code, state, error } = request.query;

			if (error) {
				return await reply.redirect(`${this.config.url}/signin?error=${encodeURIComponent(error)}`);
			}

			if (!code || !state) {
				reply.code(400);
				return { error: 'Missing code or state' };
			}

			try {
				const result = await this.oauthClientManager.completeSSOLogin(code, state, request.ip, request.headers['user-agent']);

				if (result.action === 'link') {
					return await reply.redirect(`${this.config.url}/settings/connect?linked=true`);
				} else {
					return await reply.redirect(`${this.config.url}/signin?sso_token=${result.sessionId}`);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : 'Unknown error';
				return await reply.redirect(`${this.config.url}/signin?error=${encodeURIComponent(msg)}`);
			}
		});

		done();
	}
}
