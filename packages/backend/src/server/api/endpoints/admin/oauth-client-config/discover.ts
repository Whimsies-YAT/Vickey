/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { OAuthClientConfigService } from '@/server/oauth/client/OAuthClientConfigService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireModerator: true,
	secure: true,
	kind: 'write:admin:oauth-client-config',
	res: {
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			authorization_endpoint: { type: 'string' },
			token_endpoint: { type: 'string' },
			userinfo_endpoint: { type: 'string' },
			jwks_uri: { type: 'string' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		issuer: { type: 'string', minLength: 1 },
	},
	required: ['issuer'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private oauthClientConfigService: OAuthClientConfigService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const config = await this.oauthClientConfigService.discover(ps.issuer.trim());
				return {
					authorization_endpoint: config.authorization_endpoint,
					token_endpoint: config.token_endpoint,
					userinfo_endpoint: config.userinfo_endpoint,
					jwks_uri: config.jwks_uri,
				};
			} catch (e: any) {
				if (e.statusCode === 404) {
					throw new ApiError({
						message: 'OIDC discovery failed: Configuration not found. Please check the Issuer URL.',
						code: 'OIDC_DISCOVERY_FAILED',
						id: 'a718b958-963d-4c3e-8846-952402928301',
						httpStatusCode: 400,
					});
				}
				throw e;
			}
		});
	}
}
