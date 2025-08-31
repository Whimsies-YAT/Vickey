/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AppsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';

@Injectable()
export class OAuthAppServerService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,
	) {}

	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		// Handle OAuth app client_id resolution
		fastify.get<{
			Params: { appId: string };
		}>('/oauth/app/:appId', async (request, reply) => {
			const appId = request.params.appId;

			const app = await this.appsRepository.findOneBy({ id: appId, isOAuth: true });
			if (!app || !app.callbackUrl) {
				reply.code(404);
				return { error: 'App not found' };
			}

			// Return IndieAuth client metadata
			reply.header('Content-Type', 'application/json');
			return {
				client_id: appId,
				client_name: app.name,
				client_uri: app.callbackUrl || `${ this.config.url }/oauth/app/${ appId }`,
				redirect_uris: app.callbackUrl ? [app.callbackUrl] : [],
				response_types: ['code'],
				grant_types: ['authorization_code', 'refresh_token'],
				token_endpoint_auth_method: 'client_secret_basic',
				scope: app.permission.join(' '),
			};
		});

		done();
	}
}
