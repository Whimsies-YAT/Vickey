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
	requireModerator: true,
    secure: true,
	// kind: 'read:admin:server-info',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			logs: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						id: {
							type: 'number',
							optional: false, nullable: false,
						},
						timestamp: {
							type: 'string',
							optional: false, nullable: false,
						},
						type: {
							type: 'string',
							optional: false, nullable: false,
							enum: ['stdout', 'stderr'],
						},
						content: {
							type: 'string',
							optional: false, nullable: false,
						},
					},
				},
			},
			stats: {
				type: 'object',
				optional: false, nullable: false,
				properties: {
					totalCount: {
						type: 'number',
						optional: false, nullable: false,
					},
					maxEntries: {
						type: 'number',
						optional: false, nullable: false,
					},
					oldestId: {
						type: 'number',
						optional: false, nullable: false,
					},
					newestId: {
						type: 'number',
						optional: false, nullable: false,
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		count: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
		sinceId: { type: 'integer', minimum: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private logObserverService: LogObserverService,
	) {
		super(meta, paramDef, async (ps, me) => {
			let logs;

			if (ps.sinceId !== undefined) {
				logs = this.logObserverService.getLogsSince(ps.sinceId);
			} else {
				logs = this.logObserverService.getRecentLogs(ps.count);
			}

			const stats = this.logObserverService.getLogStats();

			return {
				logs,
				stats,
			};
		});
	}
}
