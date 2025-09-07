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
	kind: 'write:account',

	res: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			preferences: {
				type: 'object',
				properties: {
					mode: { type: 'string' },
					smartRatio: { type: 'number' },
					adaptiveMode: { type: 'boolean' },
					algorithm: { type: 'string' },
					diversityLevel: { type: 'string' },
					freshnessWeight: { type: 'number' },
					qualityThreshold: { type: 'number' },
					showScoreIndicator: { type: 'boolean' },
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		mode: { 
			type: 'string', 
			enum: ['auto', 'chronological', 'smart', 'mixed'],
		},
		smartRatio: { 
			type: 'number', 
			minimum: 0, 
			maximum: 1,
		},
		adaptiveMode: { type: 'boolean' },
		algorithm: {
			type: 'string',
			enum: ['smart', 'hybrid', 'social', 'discovery'],
		},
		diversityLevel: {
			type: 'string',
			enum: ['low', 'medium', 'high'],
		},
		freshnessWeight: {
			type: 'number',
			minimum: 0,
			maximum: 1,
		},
		qualityThreshold: {
			type: 'number',
			minimum: 0,
			maximum: 1,
		},
		showScoreIndicator: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private hybridTimelineService: HybridTimelineService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const preferences: any = {};

			if (ps.mode !== undefined) {
				preferences.mode = ps.mode;
			}
			if (ps.smartRatio !== undefined) {
				preferences.smartRatio = ps.smartRatio;
			}
			if (ps.adaptiveMode !== undefined) {
				preferences.adaptiveMode = ps.adaptiveMode;
			}
			if (ps.algorithm !== undefined) {
				preferences.algorithm = ps.algorithm;
			}
			if (ps.diversityLevel !== undefined) {
				preferences.diversityLevel = ps.diversityLevel;
			}
			if (ps.freshnessWeight !== undefined) {
				preferences.freshnessWeight = ps.freshnessWeight;
			}
			if (ps.qualityThreshold !== undefined) {
				preferences.qualityThreshold = ps.qualityThreshold;
			}
			if (ps.showScoreIndicator !== undefined) {
				preferences.showScoreIndicator = ps.showScoreIndicator;
			}

			await this.hybridTimelineService.updateUserTimelinePreference(me.id, preferences);

			const updatedPreferences = await this.hybridTimelineService.getUserTimelinePreference(me.id);

			return {
				success: true,
				preferences: updatedPreferences,
			};
		});
	}
}
