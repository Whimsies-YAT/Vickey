/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import fetch from 'node-fetch';
import { Inject, Injectable } from '@nestjs/common';
import { format as dateFormat } from 'date-fns';
import mime from 'mime-types';
import archiver from 'archiver';
import { DI } from '@/di-symbols.js';
import type { AvatarDecorationsRepository, UsersRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import { DriveService } from '@/core/DriveService.js';
import { createTemp, createTempDir } from '@/misc/create-temp.js';
import { DownloadService } from '@/core/DownloadService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';

@Injectable()
export class ExportCustomAvatarDecorationProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		private driveService: DriveService,
		private downloadService: DownloadService,
		private queueLoggerService: QueueLoggerService,
		private notificationService: NotificationService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('export-custom-avatar-decoration');
	}

	@bindThis
	public async process(job: Bull.Job): Promise<void> {
		this.logger.info('Exporting custom avatar decorations ...');

		const user = await this.usersRepository.findOneBy({ id: job.data.user.id });
		if (user == null) {
			return;
		}

		const [path, cleanup] = await createTempDir();

		this.logger.info(`Temp dir is ${path}`);

		const metaPath = path + '/meta.json';

		fs.writeFileSync(metaPath, '', 'utf-8');

		const metaStream = fs.createWriteStream(metaPath, { flags: 'a' });

		const writeMeta = (text: string): Promise<void> => {
			return new Promise<void>((res, rej) => {
				metaStream.write(text, err => {
					if (err) {
						this.logger.error(err);
						rej(err);
					} else {
						res();
					}
				});
			});
		};

		await writeMeta(`{"metaVersion":2,"host":"${this.config.host}","exportedAt":"${new Date().toString()}","avatar_decorations":[`);

		const customADs = await this.avatarDecorationsRepository.find({
			order: {
				id: 'ASC',
			},
		});

		for (const cads of customADs) {
			if (/[\s"{}[\],:]/.test(cads.name)) {
				this.logger.error(`invalid avatar decoration name: ${cads.name}`);
				continue;
			}
			let fileName = cads.name;
			let ADPath = path + '/' + fileName;
			let downloaded = false;

			try {
				const response = await fetch(cads.url, { method: 'HEAD' });
				const mimeType = response.headers.get('content-type');
				const ext = mime.extension(typeof mimeType === "string" ? mimeType : 'image/png');

				if (ext) {
					fileName += `.${ext}`;
					ADPath = path + '/' + fileName;
				}

				await this.downloadService.downloadUrl(cads.url, ADPath);
				downloaded = true;
			} catch (e) {
				this.logger.error(e instanceof Error ? e : new Error(e as string));
			}

			if (!downloaded) {
				fs.unlinkSync(ADPath);
			}

			const content = JSON.stringify({
				fileName: fileName,
				downloaded: downloaded,
				avatar_decorations: cads,
			});
			const isFirst = customADs.indexOf(cads) === 0;

			await writeMeta(isFirst ? content : ',\n' + content);
		}

		await writeMeta(']}');

		metaStream.end();

		// Create archive
		await new Promise<void>(async (resolve) => {
			const [archivePath, archiveCleanup] = await createTemp();
			const archiveStream = fs.createWriteStream(archivePath);
			const archive = archiver('zip', {
				zlib: { level: 0 },
			});
			archiveStream.on('close', async () => {
				this.logger.succ(`Exported to: ${archivePath}`);

				const fileName = 'custom-avatar-decorations-' + dateFormat(new Date(), 'yyyy-MM-dd-HH-mm-ss') + '.zip';
				const driveFile = await this.driveService.addFile({ user, path: archivePath, name: fileName, force: true });

				this.logger.succ(`Exported to: ${driveFile.id}`);

				this.notificationService.createNotification(user.id, 'exportCompleted', {
					exportedEntity: 'customAvatarDecoration',
					fileId: driveFile.id,
				});

				cleanup();
				archiveCleanup();
				resolve();
			});
			archive.pipe(archiveStream);
			archive.directory(path, false);
			archive.finalize();
		});
	}
}
