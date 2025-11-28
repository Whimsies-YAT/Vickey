/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';

@Injectable()
export class CleanDeletedNotesProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('clean-deleted-notes');
	}

	@bindThis
	public async process(job: Bull.Job<Record<string, unknown>>): Promise<{
		deletedCount: number;
		skipped: boolean;
	}> {
		const retentionHours = this.meta.deletedNoteRetentionHours ?? 72;
		const collectionInstances = this.meta.deletedNoteCollectionInstances ?? [];

		if (collectionInstances.length === 0) {
			this.logger.info('Deleted note collection is disabled (empty whitelist), skipping...');
			return {
				deletedCount: 0,
				skipped: true,
			};
		}

		this.logger.info(`Cleaning deleted notes (retention: ${retentionHours} hours)...`);

		const expiryDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

		const deletedNotes = await this.notesRepository.find({
			where: {
				isDeleted: true,
				deletedAt: LessThan(expiryDate),
			},
			select: ['id'],
			take: 1000,
		});

		if (deletedNotes.length === 0) {
			this.logger.info('No expired deleted notes to clean.');
			return {
				deletedCount: 0,
				skipped: false,
			};
		}

		const noteIds = deletedNotes.map(note => note.id);
		await this.notesRepository.delete(noteIds);

		this.logger.succ(`Cleaned ${deletedNotes.length} expired deleted notes.`);

		return {
			deletedCount: deletedNotes.length,
			skipped: false,
		};
	}
}
