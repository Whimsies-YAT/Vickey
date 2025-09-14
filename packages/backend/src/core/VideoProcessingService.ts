/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { ImageProcessingService } from '@/core/ImageProcessingService.js';
import type { IImage } from '@/core/ImageProcessingService.js';
import { createTempDir } from '@/misc/create-temp.js';
import { bindThis } from '@/decorators.js';
import { appendQuery, query } from '@/misc/prelude/url.js';

@Injectable()
export class VideoProcessingService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		private fileInfoService: FileInfoService,
		private imageProcessingService: ImageProcessingService,
	) {
	}

	@bindThis
	public async generateVideoThumbnail(source: string): Promise<IImage> {
		if (!await this.fileInfoService.checkFile(source)) throw new Error("The file is invalid!");

		const [dir, cleanup] = await createTempDir();
		const outputPath = path.join(dir, 'out.png');

		try {
			await this.extractThumbnailWithFFmpeg(source, outputPath);
			return await this.imageProcessingService.convertToWebp(outputPath, 498, 422);
		} finally {
			cleanup();
		}
	}

	@bindThis
	private async extractThumbnailWithFFmpeg(inputPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const args = [
				'-i', inputPath,
				'-ss', '5%',
				'-vframes', '1',
				'-f', 'image2',
				'-y',
				outputPath
			];

			const ffmpeg = spawn('ffmpeg', args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				timeout: 30000,
			});

			let stderr = '';

			ffmpeg.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			ffmpeg.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`FFmpeg failed with code ${code}. Error: ${stderr}`));
				}
			});

			ffmpeg.on('error', (error) => {
				reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
			});

			ffmpeg.on('exit', (code, signal) => {
				if (signal === 'SIGTERM') {
					reject(new Error('FFmpeg process timed out'));
				}
			});
		});
	}

	@bindThis
	public getExternalVideoThumbnailUrl(url: string): string | null {
		if (this.config.videoThumbnailGenerator == null) return null;

		return appendQuery(
			`${this.config.videoThumbnailGenerator}/thumbnail.webp`,
			query({
				thumbnail: '1',
				url,
			}),
		);
	}
}
