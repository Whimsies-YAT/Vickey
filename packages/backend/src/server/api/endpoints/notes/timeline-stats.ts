/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SmartTimelineService } from '@/core/SmartTimelineService.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			cacheHitRate: {
				type: 'number',
				optional: false, nullable: false,
				description: 'Cache hit rate for timeline requests',
			},
			segmentDistribution: {
				type: 'object',
				optional: false, nullable: false,
				description: 'Distribution of content across timeline segments',
				additionalProperties: {
					type: 'number',
				},
			},
			averageScore: {
				type: 'number',
				optional: false, nullable: false,
				description: 'Average recommendation score',
			},
			diversityScore: {
				type: 'number',
				optional: false, nullable: false,
				description: 'Content diversity score',
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
		private smartTimelineService: SmartTimelineService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const stats = await this.smartTimelineService.getTimelineStats(me.id);

			return {
				cacheHitRate: stats.cacheHitRate,
				segmentDistribution: stats.segmentDistribution,
				averageScore: stats.averageScore,
				diversityScore: stats.diversityScore,
			};
		});
	}
}
