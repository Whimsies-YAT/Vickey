/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
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
		name: { type: 'string', minLength: 1 },
		type: { type: 'string', enum: ['oauth2', 'oidc'] },
		clientId: { type: 'string', minLength: 1 },
		clientSecret: { type: 'string', minLength: 1 },
		authorizationEndpoint: { type: 'string', minLength: 1 },
		tokenEndpoint: { type: 'string', minLength: 1 },
		userInfoEndpoint: { type: 'string', nullable: true },
		issuer: { type: 'string', nullable: true },
		jwksUri: { type: 'string', nullable: true },
		scope: { type: 'array', items: { type: 'string' }, nullable: true },
		redirectUri: { type: 'string', minLength: 1 },
		autoRegister: { type: 'boolean', default: false },
		autoUpdate: { type: 'boolean', default: true },
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
	required: ['name', 'type', 'clientId', 'clientSecret', 'authorizationEndpoint', 'tokenEndpoint', 'redirectUri'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private oauthClientConfigService: OAuthClientConfigService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const config = await this.oauthClientConfigService.create({
				name: ps.name,
				type: ps.type as 'oauth2' | 'oidc',
				clientId: ps.clientId,
				clientSecret: ps.clientSecret,
				authorizationEndpoint: ps.authorizationEndpoint,
				tokenEndpoint: ps.tokenEndpoint,
				userInfoEndpoint: ps.userInfoEndpoint ?? undefined,
				issuer: ps.issuer ?? undefined,
				jwksUri: ps.jwksUri ?? undefined,
				scope: ps.scope ?? undefined,
				redirectUri: ps.redirectUri,
				autoRegister: ps.autoRegister,
				autoUpdate: ps.autoUpdate,
				userMapping: ps.userMapping ?? undefined,
			}, me.id);

			this.moderationLogService.log(me, 'createOAuthClientConfig', {
				oauthClientConfigId: config.id,
				oauthClientConfig: config,
			});

			return config;
		});
	}
}
