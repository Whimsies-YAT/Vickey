/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { OAuthClientConfigService } from '@/server/oauth/client/OAuthClientConfigService.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireModerator: true,
	secure: true,
	kind: 'read:admin:oauth-client-config',
	res: {
		type: 'array',
		items: {
			type: 'object',
			ref: 'OAuthClientConfig',
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
		private oauthClientConfigService: OAuthClientConfigService,
	) {
		super(meta, paramDef, async (ps, me) => {
			return await this.oauthClientConfigService.list(me.id);
		});
	}
}
