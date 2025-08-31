/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedAppSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		description: {
			type: 'string',
			optional: false, nullable: false,
		},
		callbackUrl: {
			type: 'string',
			optional: false, nullable: true,
		},
		permission: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
		secret: {
			type: 'string',
			optional: true, nullable: false,
		},
		fullSecret: {
			type: 'string',
			optional: true, nullable: false,
		},
		isOAuth: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		clientId: {
			type: 'string',
			optional: false, nullable: true,
		},
		iconUrl: {
			type: 'string',
			optional: false, nullable: true,
		},
		websiteUrl: {
			type: 'string',
			optional: false, nullable: true,
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
		},
		isAuthorized: {
			type: 'boolean',
			optional: true, nullable: false,
		},
	},
} as const;
