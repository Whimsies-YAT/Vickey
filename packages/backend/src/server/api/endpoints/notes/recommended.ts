/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ContentRecommendationService } from '@/core/ContentRecommendationService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

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
			scores: {
				type: 'object',
				description: 'Recommendation scores for each note',
			},
			algorithm: {
				type: 'string',
				description: 'Algorithm used for recommendations',
			},
			factors: {
				type: 'object',
				description: 'Factor weights used in recommendation',
			},
			hasMore: {
				type: 'boolean',
				description: 'Whether there are more recommendations available',
			},
		},
	},

	errors: {
		recommendationUnavailable: {
			message: 'Recommendation service is currently unavailable.',
			code: 'RECOMMENDATION_UNAVAILABLE',
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		offset: { type: 'integer', minimum: 0, default: 0 },
		context: { 
			type: 'string', 
			enum: ['timeline', 'explore', 'related', 'trending'], 
			default: 'timeline' 
		},
		includeFollowing: { type: 'boolean', default: false },
		diversityFactor: { type: 'number', minimum: 0, maximum: 1 },
		recencyWeight: { type: 'number', minimum: 0, maximum: 1 },
		qualityThreshold: { type: 'number', minimum: 0, maximum: 1 },
		excludeNoteIds: { 
			type: 'array', 
			items: { type: 'string' },
			maxItems: 100,
			default: [] 
		},
		excludeUserIds: { 
			type: 'array', 
			items: { type: 'string' },
			maxItems: 100,
			default: [] 
		},
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private contentRecommendationService: ContentRecommendationService,
		private noteEntityService: NoteEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Get recommendations from the service
				const result = await this.contentRecommendationService.getRecommendations(me, {
					limit: ps.limit,
					offset: ps.offset,
					context: ps.context,
					includeFollowing: ps.includeFollowing,
					diversityFactor: ps.diversityFactor,
					recencyWeight: ps.recencyWeight,
					qualityThreshold: ps.qualityThreshold,
					excludeNoteIds: ps.excludeNoteIds,
					excludeUserIds: ps.excludeUserIds,
				});

				// Pack notes for API response
				const packedNotes = await this.noteEntityService.packMany(result.notes, me);

				return {
					notes: packedNotes,
					scores: result.scores,
					algorithm: result.algorithm,
					factors: result.factors,
					hasMore: result.hasMore,
				};
			} catch (error) {
				console.error('Recommendation error:', error);
				throw new ApiError(meta.errors.recommendationUnavailable);
			}
		});
	}
}
