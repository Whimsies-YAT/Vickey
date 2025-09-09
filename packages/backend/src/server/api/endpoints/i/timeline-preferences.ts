/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HybridTimelineService } from '@/core/HybridTimelineService.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'object',
		properties: {
			mode: { 
				type: 'string',
				enum: ['auto', 'chronological', 'smart', 'mixed'],
			},
			smartRatio: { type: 'number' },
			adaptiveMode: { type: 'boolean' },
			algorithm: {
				type: 'string',
				enum: ['smart', 'hybrid', 'social', 'discovery'],
			},
			diversityLevel: {
				type: 'string',
				enum: ['low', 'medium', 'high'],
			},
			freshnessWeight: { type: 'number' },
			qualityThreshold: { type: 'number' },
			showScoreIndicator: { type: 'boolean' },
			analytics: {
				type: 'object',
				properties: {
					currentMode: {
						type: 'object',
						properties: {
							type: { type: 'string' },
							smartRatio: { type: 'number' },
							reason: { type: 'string' },
						},
					},
					performanceMetrics: {
						type: 'object',
						properties: {
							cacheHitRate: { type: 'number' },
							averageLoadTime: { type: 'number' },
							contentDiversity: { type: 'number' },
						},
					},
				},
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
		private hybridTimelineService: HybridTimelineService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const [preferences, analytics] = await Promise.all([
				this.hybridTimelineService.getUserTimelinePreference(me.id),
				this.hybridTimelineService.getTimelineAnalytics(me.id),
			]);

			return {
				mode: preferences.mode,
				smartRatio: preferences.smartRatio,
				adaptiveMode: preferences.adaptiveMode,
				algorithm: preferences.algorithm || 'smart',
				diversityLevel: preferences.diversityLevel || 'medium',
				freshnessWeight: preferences.freshnessWeight ?? 0.3,
				qualityThreshold: preferences.qualityThreshold ?? 0.4,
				showScoreIndicator: preferences.showScoreIndicator ?? false,
				analytics,
			};
		});
	}
}
