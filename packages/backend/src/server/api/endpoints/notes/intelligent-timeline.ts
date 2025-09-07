/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HybridTimelineService } from '@/core/HybridTimelineService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ContentRecommendationService } from '@/core/ContentRecommendationService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,

	res: {
		type: 'object',
		properties: {
			notes: {
				type: 'array',
				items: {
					type: 'object',
					ref: 'Note',
				},
			},
			mode: {
				type: 'object',
				properties: {
					type: { type: 'string' },
					smartRatio: { type: 'number' },
					reason: { type: 'string' },
				},
			},
		},
	},

	errors: {
		timelineUnavailable: {
			message: 'Intelligent timeline service is currently unavailable.',
			code: 'TIMELINE_UNAVAILABLE',
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		sinceId: { type: 'string' },
		untilId: { type: 'string' },
		includeMyRenotes: { type: 'boolean', default: true },
		includeRenotedMyNotes: { type: 'boolean', default: true },
		includeLocalRenotes: { type: 'boolean', default: true },
		withFiles: { type: 'boolean', default: false },
		withReplies: { type: 'boolean', default: false },
		excludeNsfw: { type: 'boolean', default: false },
		mode: { 
			type: 'string', 
			enum: ['auto', 'chronological', 'smart', 'mixed'], 
			default: 'auto' 
		},
		smartRatio: { 
			type: 'number', 
			minimum: 0, 
			maximum: 1, 
			default: 0.6 
		},
		adaptiveMode: { type: 'boolean', default: true },
		algorithm: { 
			type: 'string', 
			enum: ['smart', 'hybrid', 'social', 'discovery'], 
			default: 'smart' 
		},
		diversityLevel: { 
			type: 'string', 
			enum: ['low', 'medium', 'high'], 
			default: 'medium' 
		},
		freshnessWeight: { 
			type: 'number', 
			minimum: 0, 
			maximum: 1, 
			default: 0.3 
		},
		qualityThreshold: { 
			type: 'number', 
			minimum: 0, 
			maximum: 1, 
			default: 0.4 
		},
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private hybridTimelineService: HybridTimelineService,
		private noteEntityService: NoteEntityService,
		private contentRecommendationService: ContentRecommendationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Record timeline view interaction
				await this.contentRecommendationService.recordInteraction(
					me.id,
					'timeline',
					'category',
					'view',
					{
						mode: ps.mode,
						smartRatio: ps.smartRatio,
						algorithm: ps.algorithm,
						source: 'intelligent_timeline',
					}
				);

				// Generate intelligent timeline
				const notes = await this.hybridTimelineService.generateHybridTimeline(me, {
					limit: ps.limit,
					sinceId: ps.sinceId,
					untilId: ps.untilId,
					includeMyRenotes: ps.includeMyRenotes,
					includeRenotedMyNotes: ps.includeRenotedMyNotes,
					includeLocalRenotes: ps.includeLocalRenotes,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					excludeNsfw: ps.excludeNsfw,
					mode: ps.mode,
					smartRatio: ps.smartRatio,
					adaptiveMode: ps.adaptiveMode,
					algorithm: ps.algorithm,
					diversityLevel: ps.diversityLevel,
					freshnessWeight: ps.freshnessWeight,
					qualityThreshold: ps.qualityThreshold,
				});

				// Get timeline analytics for response
				const analytics = await this.hybridTimelineService.getTimelineAnalytics(me.id);

				// Pack notes for API response
				const packedNotes = await this.noteEntityService.packMany(notes, me);

				return {
					notes: packedNotes,
					mode: analytics.currentMode,
				};
			} catch (error) {
				console.error('Intelligent timeline error:', error);
				throw new ApiError(meta.errors.timelineUnavailable);
			}
		});
	}
}
