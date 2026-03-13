/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { Inject, Injectable } from '@nestjs/common';
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
		if (!await this.fileInfoService.checkFile(source)) throw new Error('The file is invalid!');

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
		const duration = await this.getVideoDuration(inputPath);

		return new Promise((resolve, reject) => {
			try {
				const seekTimeInSeconds = Math.max(1, Math.floor(duration * 0.05));

				const args = [
					'-i', inputPath,
					'-ss', seekTimeInSeconds.toString(),
					'-vframes', '1',
					'-f', 'image2',
					'-y',
					outputPath,
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

				ffmpeg.on('exit', (_code, signal) => {
					if (signal === 'SIGTERM') {
						reject(new Error('FFmpeg process timed out'));
					}
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	@bindThis
	private async getVideoDuration(inputPath: string): Promise<number> {
		return new Promise((resolve, _reject) => {
			const args = [
				'-i', inputPath,
				'-f', 'null',
				'-',
			];

			const ffmpeg = spawn('ffmpeg', args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				timeout: 15000,
			});

			let stderr = '';

			ffmpeg.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			ffmpeg.on('close', (_code) => {
				const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);

				if (!durationMatch) {
					console.warn('Could not parse video duration, using default seek time');
					resolve(10);
					return;
				}

				const hours = parseInt(durationMatch[1], 10);
				const minutes = parseInt(durationMatch[2], 10);
				const seconds = parseFloat(durationMatch[3]);

				const totalSeconds = hours * 3600 + minutes * 60 + seconds;

				if (totalSeconds <= 0) {
					console.warn('Invalid video duration, using default seek time');
					resolve(10);
					return;
				}

				resolve(totalSeconds);
			});

			ffmpeg.on('error', (error) => {
				console.warn(`Failed to get video duration: ${error.message}, using default`);
				resolve(10);
			});

			ffmpeg.on('exit', (_code, signal) => {
				if (signal === 'SIGTERM') {
					console.warn('Video duration check timed out, using default');
					resolve(10);
				}
			});
		});
	}

	@bindThis
	public async generateVideoThumbnailAtPercentage(source: string, percentage = 5): Promise<IImage> {
		if (!await this.fileInfoService.checkFile(source)) throw new Error('The file is invalid!');

		const [dir, cleanup] = await createTempDir();
		const outputPath = path.join(dir, 'out.png');

		try {
			await this.extractThumbnailAtPercentage(source, outputPath, percentage);
			return await this.imageProcessingService.convertToWebp(outputPath, 498, 422);
		} finally {
			cleanup();
		}
	}

	@bindThis
	private async extractThumbnailAtPercentage(inputPath: string, outputPath: string, percentage: number): Promise<void> {
		const duration = await this.getVideoDuration(inputPath);

		return new Promise((resolve, reject) => {
			try {
				const clampedPercentage = Math.max(1, Math.min(95, percentage));
				const seekTimeInSeconds = Math.max(1, Math.floor(duration * clampedPercentage / 100));

				const args = [
					'-i', inputPath,
					'-ss', seekTimeInSeconds.toString(),
					'-vframes', '1',
					'-f', 'image2',
					'-y',
					outputPath,
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

				ffmpeg.on('exit', (_code, signal) => {
					if (signal === 'SIGTERM') {
						reject(new Error('FFmpeg process timed out'));
					}
				});
			} catch (error) {
				reject(error);
			}
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
