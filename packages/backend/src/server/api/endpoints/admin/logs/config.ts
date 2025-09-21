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
			maxEntries: {
				type: 'number',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		maxEntries: { type: 'integer', minimum: 1000, maximum: 100000 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private logObserverService: LogObserverService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.maxEntries !== undefined) {
				this.logObserverService.setMaxEntries(ps.maxEntries);
			}

			const stats = this.logObserverService.getLogStats();

			return {
				maxEntries: stats.maxEntries,
			};
		});
	}
}
