/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { OAuthClientManager } from '@/server/oauth/client/OAuthClientManager.js';

export const meta = {
	tags: ['sso'],
	requireCredential: false,
	requireModerator: false,
	secure: true,
	kind: 'read:sso-providers',
	res: {
		type: 'array',
		items: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				type: { type: 'string' },
				iconUrl: { type: 'string', nullable: true }, // For future use
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private oauthClientManager: OAuthClientManager,
	) {
		super(meta, paramDef, async (ps, me) => {
			const providers = this.oauthClientManager.getAvailableProviders();
			return providers.map(p => ({
				id: p.id,
				name: p.name,
				type: p.type,
			}));
		});
	}
}
