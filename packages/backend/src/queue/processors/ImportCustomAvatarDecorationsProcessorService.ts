/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { ZipReader } from 'slacc';
import { DI } from '@/di-symbols.js';
import type { AvatarDecorationsRepository, DriveFilesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { AvatarDecorationService } from '@/core/AvatarDecorationService.js';
import { createTempDir } from '@/misc/create-temp.js';
import { DriveService } from '@/core/DriveService.js';
import { DownloadService } from '@/core/DownloadService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';
import type { DbUserImportJobData } from '../types.js';
import {ApiError} from "@/server/api/error.js";
import {meta} from "@/server/api/endpoints/drive/files/delete.js";

// TODO: 名前衝突時の動作を選べるようにする
@Injectable()
export class ImportCustomAvatarDecorationsProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		private avatarDecorationService: AvatarDecorationService,
		private driveService: DriveService,
		private downloadService: DownloadService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('import-custom-emojis');
	}

	@bindThis
	public async process(job: Bull.Job<DbUserImportJobData>): Promise<void> {
		this.logger.info('Importing custom avatar decorations ...');

		const file = await this.driveFilesRepository.findOneBy({
			id: job.data.fileId,
		});
		if (file == null) {
			return;
		}

		const [path, cleanup] = await createTempDir();

		this.logger.info(`Temp dir is ${path}`);

		const destPath = path + '/avatar_decorations.zip';

		try {
			fs.writeFileSync(destPath, '', 'binary');
			await this.downloadService.downloadUrl(file.url, destPath);
		} catch (e) { // TODO: 何度か再試行
			if (e instanceof Error || typeof e === 'string') {
				this.logger.error(e);
			}
			throw e;
		}

		const outputPath = path + '/avatar_decorations';
		try {
			this.logger.succ(`Unzipping to ${outputPath}`);
			ZipReader.withDestinationPath(outputPath).viaBuffer(await fs.promises.readFile(destPath));
			const metaRaw = fs.readFileSync(outputPath + '/meta.json', 'utf-8');
			const meta = JSON.parse(metaRaw);

			for (const record of meta.avatar_decorations) {
				if (!record.downloaded) continue;
				if (/[\s"{}[\],:]/.test(record.fileName)) {
					this.logger.error(`invalid filename: ${record.fileName}`);
					continue;
				}
				const adInfo = record.avatar_decorations;
				if (/[\s"{}[\],:]/.test(adInfo.name)) {
					this.logger.error(`invalid adname: ${adInfo.name}`);
					continue;
				}
				const adPath = outputPath + '/' + record.fileName;
				const adExist = await this.avatarDecorationsRepository.findOneBy({ name: adInfo.name });

				if (adExist) {
					await this.avatarDecorationsRepository.delete({
						name: adInfo.name,
					});
					const file = await this.driveFilesRepository.findOneBy({ id: adExist.driveId });

					if (file == null) {
						this.logger.error(`Cannot delete ${ adInfo.id } (${ adInfo.driveId }). Ignored.`);
						continue;
					}
					await this.driveService.deleteFile(file);
				}
				try {
					const driveFile = await this.driveService.addFile({
						user: null,
						path: adPath,
						name: record.fileName,
						force: true,
					});
					await this.avatarDecorationService.add({
						name: adInfo.name,
						url: driveFile.webpublicUrl ?? driveFile.url,
						description: adInfo.description,
						roleIdsThatCanBeUsedThisDecoration: [],
						driveId: driveFile.id,
					});
				} catch (e) {
					if (e instanceof Error || typeof e === 'string') {
						this.logger.error(`couldn't import ${adPath} for ${adInfo.name}: ${e}`);
					}
					continue;
				}
			}

			cleanup();

			this.logger.succ('Imported');
		} catch (e) {
			if (e instanceof Error || typeof e === 'string') {
				this.logger.error(e);
			}
			cleanup();
			throw e;
		}
	}
}
