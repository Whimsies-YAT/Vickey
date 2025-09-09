/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RiskEventLogService } from '@/core/RiskEventLogService.js';

export const meta = {
	tags: ['admin', 'users'],

	requireCredential: true,
	requireAdmin: true,
	secure: true,
	kind: 'read:admin:user-risk-scores',

	res: {
		type: 'array',
		nullable: false,
		optional: false,
		items: {
			type: 'object',
			nullable: false,
			optional: false,
			properties: {
				id: {
					type: 'string',
					nullable: false,
					optional: false,
				},
				eventType: {
					type: 'string',
					nullable: false,
					optional: false,
				},
				userId: {
					type: 'string',
					nullable: false,
					optional: false,
				},
				riskScore: {
					type: 'number',
					nullable: false,
					optional: false,
				},
				riskLevel: {
					type: 'string',
					nullable: false,
					optional: false,
					enum: ['low', 'medium', 'high', 'critical'],
				},
				details: {
					type: 'object',
					nullable: false,
					optional: false,
				},
				timestamp: {
					type: 'string',
					nullable: false,
					optional: false,
					format: 'date-time',
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		hours: { type: 'integer', minimum: 1, maximum: 720, default: 24 },
		limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private riskEventLogService: RiskEventLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userId) {
				return await this.riskEventLogService.getRiskEventsForUser(ps.userId, ps.limit);
			} else {
				return await this.riskEventLogService.getRecentHighRiskEvents(ps.hours, ps.limit);
			}
		});
	}
}
