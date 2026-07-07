/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import type { NotesRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { Not, IsNull } from 'typeorm';

@Injectable()
export class CommandService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.elasticsearch)
		private elasticsearch: ElasticSearch | null,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private metaService: MetaService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('CommandService');
	}

	@bindThis
	public async ping() {
		console.log('pong');
	}

	@bindThis
	public async resetCaptcha() {
		await this.metaService.update({
			enableHcaptcha: false,
			hcaptchaSiteKey: null,
			hcaptchaSecretKey: null,
			enableMcaptcha: false,
			mcaptchaSitekey: null,
			mcaptchaSecretKey: null,
			mcaptchaInstanceUrl: null,
			enableRecaptcha: false,
			recaptchaSiteKey: null,
			recaptchaSecretKey: null,
			enableTurnstile: false,
			turnstileSiteKey: null,
			turnstileSecretKey: null,
			enableTestcaptcha: false,
		});
	}

	@bindThis
	public async rebuildElasticsearchIndex() {
		if (!this.elasticsearch) {
			this.logger.error('Elasticsearch is not configured');
			console.error('ERROR: Elasticsearch is not configured');
			return;
		}

		if (!this.config.elasticsearch) {
			this.logger.error('Elasticsearch configuration is missing');
			console.error('ERROR: Elasticsearch configuration is missing');
			return;
		}

		console.log('='.repeat(80));
		console.log('Elasticsearch Index Rebuild');
		console.log('='.repeat(80));
		console.log('WARNING: Search will be UNAVAILABLE during rebuild process');
		console.log('WARNING: This process may take hours depending on data size');
		console.log('='.repeat(80));

		const BATCH_SIZE = 10000;
		const BATCH_LIMIT = 50;
		const MAX_RETRIES = 7;
		const RETRY_DELAY_MS = 5000;

		const indexBase = `${this.config.elasticsearch.index}---notes`;
		const month = new Date().toISOString().slice(0, 7).replace(/-/g, '');
		let offset = 0;
		let batchCount = 0;
		let totalProcessed = 0;
		let currentIndex = `${indexBase}-${month}-${Math.floor(batchCount / BATCH_LIMIT) + 1}`;

		const generateIndexName = (batchNum: number): string => {
			return `${indexBase}-${month}-${Math.floor(batchNum / BATCH_LIMIT) + 1}`;
		};

		try {
			this.logger.info('Starting Elasticsearch index rebuild...');
			console.log('\n[INFO] Starting Elasticsearch index rebuild...');

			while (true) {
				const notes = await this.notesRepository.find({
					where: {
						text: Not(IsNull()),
					},
					select: { id: true, userId: true, userHost: true, channelId: true, cw: true, text: true, tags: true },
					order: { id: 'ASC' },
					take: BATCH_SIZE,
					skip: offset,
				});

				if (notes.length === 0) {
					this.logger.info('No more notes to process');
					console.log('[INFO] No more notes to process.');
					break;
				}

				const bulkBody = notes.flatMap(note => [
					{ index: { _index: currentIndex, _id: note.id } },
					{
						createdAt: this.idService.parse(note.id).date.getTime(),
						userId: note.userId,
						userHost: note.userHost,
						channelId: note.channelId,
						cw: note.cw,
						text: note.text,
						tags: note.tags,
					},
				]);

				let retries = MAX_RETRIES;
				let success = false;

				while (retries > 0 && !success) {
					try {
						await this.elasticsearch.bulk({ body: bulkBody });
						success = true;
					} catch (error) {
						retries--;
						this.logger.error(`Error while writing to Elasticsearch: ${error}`);
						console.error(`[ERROR] Failed to write batch. Retries left: ${retries}`);

						if (retries > 0) {
							console.log(`[INFO] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
							await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
						} else {
							throw error;
						}
					}
				}

				batchCount++;
				offset += BATCH_SIZE;
				totalProcessed += notes.length;

				if (batchCount % BATCH_LIMIT === 0) {
					currentIndex = generateIndexName(batchCount);
					console.log(`[INFO] Switching to new index: ${currentIndex}`);
				}

				if (batchCount % 10 === 0 || notes.length < BATCH_SIZE) {
					console.log(`[PROGRESS] Processed ${totalProcessed} notes (offset=${offset}, batches=${batchCount})`);
				}

				if (notes.length < BATCH_SIZE) {
					break;
				}
			}

			console.log('\n' + '='.repeat(80));
			console.log(`[SUCCESS] Rebuild completed!`);
			console.log(`Total notes processed: ${totalProcessed}`);
			console.log(`Total batches: ${batchCount}`);
			console.log('='.repeat(80));
			this.logger.info(`Elasticsearch index rebuild completed. Total: ${totalProcessed} notes, ${batchCount} batches`);

			console.log('\n[INFO] Cleaning up old indices...');
			this.logger.info('Starting cleanup of old indices');

			try {
				const allIndices = await this.elasticsearch.cat.indices({
					index: `${indexBase}*`,
					format: 'json',
					h: ['index'],
				}) as Array<{ index: string }>;

				const newIndices = new Set<string>();
				for (let i = 0; i < batchCount; i++) {
					newIndices.add(generateIndexName(i));
				}

				const indicesToDelete: string[] = [];
				for (const indexInfo of allIndices) {
					if (!newIndices.has(indexInfo.index)) {
						indicesToDelete.push(indexInfo.index);
					}
				}

				if (indicesToDelete.length > 0) {
					console.log(`[INFO] Found ${indicesToDelete.length} old indices to delete`);
					this.logger.info(`Deleting ${indicesToDelete.length} old indices: ${indicesToDelete.join(', ')}`);

					for (const indexToDelete of indicesToDelete) {
						try {
							await this.elasticsearch.indices.delete({ index: indexToDelete });
							console.log(`[INFO] Deleted index: ${indexToDelete}`);
						} catch (deleteError) {
							this.logger.error(`Failed to delete index ${indexToDelete}:`, deleteError as Error);
							console.error(`[ERROR] Failed to delete index: ${indexToDelete}`);
						}
					}

					console.log(`[SUCCESS] Cleanup completed. Deleted ${indicesToDelete.length} old indices`);
					this.logger.info(`Cleanup completed. Deleted ${indicesToDelete.length} old indices`);
				} else {
					console.log('[INFO] No old indices to delete');
					this.logger.info('No old indices found to delete');
				}
			} catch (cleanupError) {
				this.logger.error('Failed to cleanup old indices:', cleanupError as Error);
				console.error(`[ERROR] Failed to cleanup old indices: ${cleanupError}`);
				console.error('[WARNING] Rebuild succeeded but cleanup failed. Old indices may still exist.');
			}

			console.log('\n' + '='.repeat(80));
			console.log('[SUCCESS] Elasticsearch index rebuild and cleanup completed!');
			console.log('='.repeat(80));
		} catch (error) {
			console.error('\n' + '='.repeat(80));
			console.error('[ERROR] Rebuild failed!');
			console.error(`Error: ${error}`);
			console.error(`Last successful offset: ${offset}`);
			console.error('='.repeat(80));
			this.logger.error(`Elasticsearch index rebuild failed at offset ${offset}:`, error as Error);
			throw error;
		}
	}
}
