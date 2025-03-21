/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedSigninSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		ip: {
			oneOf: [
				{
					type: 'string',
					nullable: false,
					optional: false,
				},
				{
					type: 'array',
					items: {
						type: 'string',
					},
					nullable: false,
					optional: false,
				},
			],
		},
		headers: {
			type: 'object',
			optional: false, nullable: false,
		},
		success: {
			type: 'boolean',
			optional: false, nullable: false,
		},
	},
} as const;
