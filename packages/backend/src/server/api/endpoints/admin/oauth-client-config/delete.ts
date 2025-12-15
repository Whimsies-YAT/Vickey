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
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
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
			const deletedConfig = await this.oauthClientConfigService.delete(ps.id, me.id);

			this.moderationLogService.log(me, 'deleteOAuthClientConfig', {
				oauthClientConfigId: deletedConfig.id,
				oauthClientConfig: deletedConfig,
			});
		});
	}
}
