/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SmartTimelineService } from '@/core/SmartTimelineService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ContentRecommendationService } from '@/core/ContentRecommendationService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		timelineUnavailable: {
			message: 'Smart timeline service is currently unavailable.',
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
		offset: { type: 'integer', minimum: 0, default: 0 },
		includeMyRenotes: { type: 'boolean', default: true },
		includeRenotedMyNotes: { type: 'boolean', default: true },
		includeLocalRenotes: { type: 'boolean', default: true },
		withFiles: { type: 'boolean', default: false },
		withReplies: { type: 'boolean', default: false },
		excludeNsfw: { type: 'boolean', default: false },
		enableCrossTimelineData: { type: 'boolean', default: true },
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
		private smartTimelineService: SmartTimelineService,
		private noteEntityService: NoteEntityService,
		private contentRecommendationService: ContentRecommendationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const isInitialLoad = !ps.sinceId && !ps.untilId && ps.offset === 0;
				
				if (isInitialLoad) {
					await this.contentRecommendationService.recordInteraction(
						me.id,
						'smart_timeline',
						'category',
						'view',
						{
							algorithm: ps.algorithm,
							diversityLevel: ps.diversityLevel,
							source: 'smart_timeline_initial',
						}
					);
				}

				const notes = await this.smartTimelineService.generateSmartTimeline(me, {
					limit: ps.limit,
					sinceId: ps.sinceId,
					untilId: ps.untilId,
					offset: ps.offset,
					includeMyRenotes: ps.includeMyRenotes,
					includeRenotedMyNotes: ps.includeRenotedMyNotes,
					includeLocalRenotes: ps.includeLocalRenotes,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					excludeNsfw: ps.excludeNsfw,
					enableCrossTimelineData: ps.enableCrossTimelineData,
					algorithm: ps.algorithm,
					diversityLevel: ps.diversityLevel,
					freshnessWeight: ps.freshnessWeight,
					qualityThreshold: ps.qualityThreshold,
				});

				const packedNotes = await this.noteEntityService.packMany(notes, me);

				if (isInitialLoad && packedNotes.length > 0) {
					await this.smartTimelineService.logUserInteraction(
						me.id,
						'smart_timeline_batch',
						'category',
						'view',
						{
							weight: 0.1,
							context: {
								count: packedNotes.length,
								algorithm: ps.algorithm,
								source: 'timeline_endpoint'
							},
							implicit: true,
						}
					);
				}

				return packedNotes;
			} catch (error) {
				console.error('Smart timeline endpoint error:', error);
				throw new ApiError(meta.errors.timelineUnavailable);
			}
		});
	}
}
