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
import { IdService } from '@/core/IdService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin', 'notes'],

	requireCredential: true,
	requireModerator: true,
	secure: true,

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
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'c3d4e5f6-789a-01bc-def0-345678901234',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		deletedAfter: { type: 'string', nullable: true },
		deletedBefore: { type: 'string', nullable: true },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private roleService: RoleService,
		private moderationLogService: ModerationLogService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Double-check permissions
			if (!await this.roleService.isModerator(me)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const query = this.notesRepository.createQueryBuilder('note')
				.where('note.isDeleted = TRUE')
				.leftJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser')
				.orderBy('note.id', 'DESC');

			if (ps.userId) {
				query.andWhere('note.userId = :userId', { userId: ps.userId });
			}

			if (ps.deletedAfter) {
				query.andWhere('note.id > :afterId', { afterId: this.idService.gen(new Date(ps.deletedAfter).getTime()) });
			}

			if (ps.deletedBefore) {
				query.andWhere('note.id < :beforeId', { beforeId: this.idService.gen(new Date(ps.deletedBefore).getTime()) });
			}

			if (ps.sinceId) {
				query.andWhere('note.id > :sinceId', { sinceId: ps.sinceId });
			}

			if (ps.untilId) {
				query.andWhere('note.id < :untilId', { untilId: ps.untilId });
			}

			const notes = await query.limit(ps.limit).getMany();

			this.moderationLogService.log(me, 'listDeletedNotes', {
				count: notes.length,
				limit: ps.limit,
				userId: ps.userId || null,
				deletedAfter: ps.deletedAfter || null,
				deletedBefore: ps.deletedBefore || null,
			});

			return await this.noteEntityService.packMany(notes, me, {
				detail: true,
				skipHide: true,
			});
		});
	}
}
