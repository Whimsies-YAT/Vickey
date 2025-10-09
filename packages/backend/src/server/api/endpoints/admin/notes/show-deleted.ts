/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';
import type { NotesRepository } from '@/models/_.js';
import { RoleService } from '@/core/RoleService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin', 'notes'],

	requireCredential: true,
	requireModerator: true,
	secure: true,

	res: {
		type: 'object',
		optional: false, nullable: true,
		ref: 'Note',
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'a1b2c3d4-5678-90ab-cdef-123456789012',
		},

		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'b2c3d4e5-6789-01bc-def0-234567890123',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private roleService: RoleService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isModerator(me)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const note = await this.notesRepository.findOne({
				where: { id: ps.noteId },
				relations: ['user', 'reply', 'renote', 'reply.user', 'renote.user'],
			});

			if (note == null) {
				throw new ApiError(meta.errors.noSuchNote);
			}

			this.moderationLogService.log(me, 'viewDeletedNote', {
				noteId: note.id,
				noteUserId: note.userId,
				noteText: note.text?.substring(0, 100) || 'No text content',
				isDeleted: note.isDeleted,
			});

			return await this.noteEntityService.pack(note, me, {
				detail: true,
				skipHide: true,
			});
		});
	}
}
