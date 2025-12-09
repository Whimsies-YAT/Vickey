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
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

@Injectable()
export class SsoServerService {
	constructor(
		@Inject(DI.config)
		private config: Config,
		private oauthClientManager: OAuthClientManager,
		private ssoService: SSOService,
		private authenticateService: AuthenticateService,
	) {}

	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		// Initialize login flow
		fastify.get<{
			Params: { providerId: string };
		}>('/sso/connect/:providerId', async (request, reply) => {
			const providerId = request.params.providerId;

			let userId: string | undefined;
			if (request.headers.cookie) {
				const match = request.headers.cookie.match(/i=([^;]+)/);
				if (match && match[1]) {
					try {
						const authResult = await this.authenticateService.authenticate(match[1]);
						if (authResult.user) {
							userId = authResult.user.id;
						}
					} catch (e) {
						// Ignore invalid tokens
					}
				}
			}

			try {
				const { authUrl } = await this.ssoService.initializeLogin(providerId, userId);
				return await reply.redirect(authUrl);
			} catch (error) {
				reply.code(400);
				return { error: 'Failed to initialize login' };
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
