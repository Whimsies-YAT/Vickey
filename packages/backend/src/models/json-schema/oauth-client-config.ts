/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Schema } from '@/misc/json-schema.js';

export const packedOAuthClientConfigSchema = {
	type: 'object',
	optional: false,
	nullable: false,
	properties: {
		id: {
			type: 'string',
			optional: false,
			nullable: false,
			format: 'id',
			description: 'The unique identifier for this OAuth client configuration.',
			example: '995a9g5c6d',
		},
		name: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The display name of the OAuth provider.',
		},
		type: {
			type: 'string',
			optional: false,
			nullable: false,
			enum: ['oauth2', 'oidc'],
			description: 'The type of OAuth provider.',
		},
		clientId: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The OAuth client ID.',
		},
		clientSecret: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The OAuth client secret.',
		},
		authorizationEndpoint: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The OAuth authorization endpoint URL.',
		},
		tokenEndpoint: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The OAuth token endpoint URL.',
		},
		userInfoEndpoint: {
			type: 'string',
			optional: true,
			nullable: true,
			description: 'The OAuth user info endpoint URL.',
		},
		issuer: {
			type: 'string',
			optional: true,
			nullable: true,
			description: 'The OIDC issuer URL.',
		},
		jwksUri: {
			type: 'string',
			optional: true,
			nullable: true,
			description: 'The OIDC JWK Set endpoint URL.',
		},
		scope: {
			type: 'array',
			optional: false,
			nullable: false,
			items: {
				type: 'string',
				optional: false,
				nullable: false,
			},
			description: 'The OAuth scopes to request.',
		},
		redirectUri: {
			type: 'string',
			optional: false,
			nullable: false,
			description: 'The OAuth redirect URI.',
		},
		autoRegister: {
			type: 'boolean',
			optional: false,
			nullable: false,
			description: 'Whether to automatically register new users.',
		},
		autoUpdate: {
			type: 'boolean',
			optional: false,
			nullable: false,
			description: 'Whether to automatically update user information.',
		},
		userMapping: {
			type: 'object',
			optional: false,
			nullable: false,
			properties: {
				username: {
					type: 'string',
					optional: true,
					nullable: true,
				},
				email: {
					type: 'string',
					optional: true,
					nullable: true,
				},
				name: {
					type: 'string',
					optional: true,
					nullable: true,
				},
				avatar: {
					type: 'string',
					optional: true,
					nullable: true,
				},
			},
			description: 'User field mapping configuration.',
		},
		isActive: {
			type: 'boolean',
			optional: false,
			nullable: false,
			description: 'Whether this configuration is active.',
		},
	},
} as const satisfies Schema;
