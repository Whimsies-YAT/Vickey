/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { LogObserverService } from '@/core/LogObserverService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
    secure: true,
	// kind: 'write:admin:server-info',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			success: {
				type: 'boolean',
				optional: false, nullable: false,
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
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private logObserverService: LogObserverService,
	) {
		super(meta, paramDef, async (ps, me) => {
			this.logObserverService.clearLogs();

			return {
				success: true,
			};
		});
	}
}
