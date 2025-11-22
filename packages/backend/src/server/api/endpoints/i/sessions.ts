/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { UserSessionEntityService } from '@/core/entities/UserSessionEntityService.js';

export const meta = {
	requireCredential: true,
	secure: true,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'id' },
				createdAt: { type: 'string', format: 'date-time' },
				lastUsedAt: { type: 'string', format: 'date-time' },
				deviceId: { type: 'string' },
				deviceName: { type: 'string' },
				deviceType: { type: 'string' },
				ip: { type: 'string' },
				location: { type: 'string' },
				isCurrent: { type: 'boolean' },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private userSessionsService: UserSessionsService,
		private userSessionEntityService: UserSessionEntityService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers, rawToken) => {
			const sessions = await this.userSessionsService.listUserSessions(me.id);

			return await this.userSessionEntityService.packMany(sessions, {
				currentToken: rawToken ?? undefined,
			});
		});
	}
}
