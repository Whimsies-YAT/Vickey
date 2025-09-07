/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ContentRecommendationService } from '@/core/ContentRecommendationService.js';
import { DI } from '@/di-symbols.js';
import type { NotesRepository } from '@/models/_.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'write:account',

	res: {
		type: 'object',
		properties: {
			success: {
				type: 'boolean',
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
		},
		interactionFailed: {
			message: 'Failed to record interaction.',
			code: 'INTERACTION_FAILED',
			id: 'b2c3d4e5-f6g7-8901-bcde-f23456789012',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		targetId: { type: 'string' },
		targetType: { 
			type: 'string', 
			enum: ['note', 'user', 'hashtag', 'category'] 
		},
		interactionType: { 
			type: 'string', 
			enum: ['view', 'like', 'reply', 'renote', 'follow', 'bookmark', 'share', 'click'] 
		},
		duration: { type: 'integer', minimum: 0 },
		source: { type: 'string' },
		position: { type: 'integer', minimum: 0 },
		deviceType: { type: 'string' },
		sentiment: { type: 'number', minimum: -1, maximum: 1 },
	},
	required: ['targetId', 'targetType', 'interactionType'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private contentRecommendationService: ContentRecommendationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Validate target exists if it's a note
				if (ps.targetType === 'note') {
					const note = await this.notesRepository.findOneBy({ id: ps.targetId });
					if (!note) {
						throw new ApiError(meta.errors.noSuchNote);
					}
				}

				// Record the interaction
				await this.contentRecommendationService.recordInteraction(
					me.id,
					ps.targetId,
					ps.targetType,
					ps.interactionType,
					{
						duration: ps.duration,
						source: ps.source,
						position: ps.position,
						deviceType: ps.deviceType,
						sentiment: ps.sentiment,
						timeOfDay: new Date().getHours(),
					}
				);

				return {
					success: true,
				};
			} catch (error) {
				if (error instanceof ApiError) {
					throw error;
				}
				console.error('Interaction recording error:', error);
				throw new ApiError(meta.errors.interactionFailed);
			}
		});
	}
}
