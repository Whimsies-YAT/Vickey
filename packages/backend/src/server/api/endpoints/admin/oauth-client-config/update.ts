/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { OAuthClientConfigService } from '@/server/oauth/client/OAuthClientConfigService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

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
		ref: 'OAuthClientConfig',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, nullable: true },
		type: { type: 'string', enum: ['oauth2', 'oidc'], nullable: true },
		clientId: { type: 'string', minLength: 1, nullable: true },
		clientSecret: { type: 'string', minLength: 1, nullable: true },
		authorizationEndpoint: { type: 'string', minLength: 1, nullable: true },
		tokenEndpoint: { type: 'string', minLength: 1, nullable: true },
		userInfoEndpoint: { type: 'string', nullable: true },
		issuer: { type: 'string', nullable: true },
		jwksUri: { type: 'string', nullable: true },
		scope: { type: 'array', items: { type: 'string' }, nullable: true },
		redirectUri: { type: 'string', minLength: 1, nullable: true },
		autoRegister: { type: 'boolean', nullable: true },
		autoUpdate: { type: 'boolean', nullable: true },
		userMapping: {
			type: 'object',
			properties: {
				username: { type: 'string', nullable: true },
				email: { type: 'string', nullable: true },
				name: { type: 'string', nullable: true },
				avatar: { type: 'string', nullable: true },
			},
			nullable: true,
		},
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private oauthClientConfigService: OAuthClientConfigService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const before = await this.oauthClientConfigService.get(ps.id, me.id);
			if (!before) throw new Error('OAuth client configuration not found');

			const config = await this.oauthClientConfigService.update({
				id: ps.id,
				name: ps.name ?? undefined,
				type: ps.type as 'oauth2' | 'oidc' | null | undefined ?? undefined,
				clientId: ps.clientId ?? undefined,
				clientSecret: ps.clientSecret ?? undefined,
				authorizationEndpoint: ps.authorizationEndpoint ?? undefined,
				tokenEndpoint: ps.tokenEndpoint ?? undefined,
				userInfoEndpoint: ps.userInfoEndpoint ?? undefined,
				issuer: ps.issuer ?? undefined,
				jwksUri: ps.jwksUri ?? undefined,
				scope: ps.scope ?? undefined,
				redirectUri: ps.redirectUri ?? undefined,
				autoRegister: ps.autoRegister ?? undefined,
				autoUpdate: ps.autoUpdate ?? undefined,
				userMapping: ps.userMapping ? {
					username: ps.userMapping.username ?? undefined,
					email: ps.userMapping.email ?? undefined,
					name: ps.userMapping.name ?? undefined,
					avatar: ps.userMapping.avatar ?? undefined,
				} : undefined,
			}, me.id);

			this.moderationLogService.log(me, 'updateOAuthClientConfig', {
				oauthClientConfigId: config.id,
				before: before,
				after: config,
			});

			return config;
		});
	}
}
