/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import rename from 'rename';
import sharp from 'sharp';
import { sharpBmp } from '@misskey-dev/sharp-read-bmp';
import type { Config } from '@/config.js';
import type { MiDriveFile, DriveFilesRepository, MiMeta, MetasRepository } from '@/models/_.js';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { createTemp } from '@/misc/create-temp.js';
import { FILE_TYPE_BROWSERSAFE } from '@/const.js';
import { StatusError } from '@/misc/status-error.js';
import type Logger from '@/logger.js';
import { DownloadService } from '@/core/DownloadService.js';
import { IImageStreamable, ImageProcessingService, webpDefault } from '@/core/ImageProcessingService.js';
import { VideoProcessingService } from '@/core/VideoProcessingService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { contentDisposition } from '@/misc/content-disposition.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { S3Service } from '@/core/S3Service.js';
import { bindThis } from '@/decorators.js';
import { isMimeImage } from '@/misc/is-mime-image.js';
import { correctFilename } from '@/misc/correct-filename.js';
import { handleRequestRedirectToOmitSearch } from '@/misc/fastify-hook-handlers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginOptions } from 'fastify';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const assets = `${_dirname}/../../server/file/assets/`;

@Injectable()
export class FileServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.metasRepository)
		private metasRepository: MetasRepository,

		private fileInfoService: FileInfoService,
		private downloadService: DownloadService,
		private imageProcessingService: ImageProcessingService,
		private videoProcessingService: VideoProcessingService,
		private internalStorageService: InternalStorageService,
		private s3Service: S3Service,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('server', 'gray');

		//this.createServer = this.createServer.bind(this);
	}

	@bindThis
	private handleRangeRequest(
		filePath: string,
		fileSize: number,
		range: string,
		reply: any
	): NodeJS.ReadableStream | null {
		if (!range || fileSize <= 0) return null;

		const parts = range.replace(/bytes=/, '').split('-');
		const start = parseInt(parts[0], 10);
		let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
		if (end > fileSize) {
			end = fileSize - 1;
		}
		const chunksize = end - start + 1;

		reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
		reply.header('Accept-Ranges', 'bytes');
		reply.header('Content-Length', chunksize);
		reply.code(206);

		return fs.createReadStream(filePath, { start, end });
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.addHook('onRequest', (request, reply, done) => {
			reply.header('Content-Security-Policy', 'default-src \'none\'; img-src \'self\'; media-src \'self\'; style-src \'unsafe-inline\'');
			if (process.env.NODE_ENV === 'development') {
				reply.header('Access-Control-Allow-Origin', '*');
			}
			done();
		});

		fastify.register((fastify, options, done) => {
			fastify.addHook('onRequest', handleRequestRedirectToOmitSearch);
			fastify.get('/files/app-default.jpg', (request, reply) => {
				const file = fs.createReadStream(`${_dirname}/assets/dummy.png`);
				reply.header('Content-Type', 'image/jpeg');
				reply.header('Cache-Control', 'max-age=31536000, immutable');
				return reply.send(file);
			});

			fastify.get<{ Params: { key: string; } }>('/files/:key', async (request, reply) => {
				return await this.sendDriveFile(request, reply)
					.catch(err => this.errorHandler(request, reply, err));
			});
			fastify.get<{ Params: { key: string; } }>('/files/:key/*', async (request, reply) => {
				return await reply.redirect(`${this.config.url}/files/${request.params.key}`, 301);
			});
			done();
		});

		fastify.get<{
			Params: { url: string; };
			Querystring: { url?: string; };
		}>('/proxy/:url*', async (request, reply) => {
			return await this.proxyHandler(request, reply)
				.catch(err => this.errorHandler(request, reply, err));
		});

		done();
	}

	@bindThis
	private async errorHandler(request: FastifyRequest<{ Params?: { [x: string]: any }; Querystring?: { [x: string]: any }; }>, reply: FastifyReply, err?: any) {
		this.logger.error(`${err}`);

		reply.header('Cache-Control', 'max-age=300');

		if (request.query && 'fallback' in request.query) {
			return reply.sendFile('/dummy.png', assets);
		}

		if (err instanceof StatusError && (err.statusCode === 302 || err.isClientError)) {
			reply.code(err.statusCode);
			return;
		}

		reply.code(500);
		return;
	}

	@bindThis
	private async sendDriveFile(request: FastifyRequest<{ Params: { key: string; } }>, reply: FastifyReply) {
		const key = request.params.key;
		const file = await this.getFileFromKey(key);

		if (file === '404') {
			reply.code(404);
			reply.header('Cache-Control', 'max-age=86400');
			return reply.sendFile('/dummy.png', assets);
		}

		if (file === '204') {
			reply.code(204);
			reply.header('Cache-Control', 'max-age=86400');
			return;
		}

		try {
			if (file.state === 'remote') {
				let image: IImageStreamable | null = null;

				const isInternalUrlFormat = file.url.startsWith(`${this.config.url}/files/`);

				if (!isInternalUrlFormat) {
					if (file.fileRole === 'thumbnail') {
						if (isMimeImage(file.mime, 'sharp-convertible-image-with-bmp')) {
							reply.header('Cache-Control', 'max-age=31536000, immutable');

							const url = new URL(`${this.config.mediaProxy}/static.webp`);
							url.searchParams.set('url', file.url);
							url.searchParams.set('static', '1');

							file.cleanup();
							return await reply.redirect(url.toString(), 301);
						} else if (file.mime.startsWith('video/')) {
							const externalThumbnail = this.videoProcessingService.getExternalVideoThumbnailUrl(file.url);
							if (externalThumbnail) {
								file.cleanup();
								return await reply.redirect(externalThumbnail, 301);
							}

							image = await this.videoProcessingService.generateVideoThumbnail(file.path);
						}
					}

					if (file.fileRole === 'webpublic') {
						if (['image/svg+xml'].includes(file.mime)) {
							reply.header('Cache-Control', 'max-age=31536000, immutable');

							const url = new URL(`${this.config.mediaProxy}/svg.webp`);
							url.searchParams.set('url', file.url);

							file.cleanup();
							return await reply.redirect(url.toString(), 301);
						}
					}
				} else {
					if (file.fileRole === 'thumbnail' && file.mime.startsWith('video/')) {
						const externalThumbnail = this.videoProcessingService.getExternalVideoThumbnailUrl(file.url);
						if (externalThumbnail) {
							file.cleanup();
							return await reply.redirect(externalThumbnail, 301);
						}

						image = await this.videoProcessingService.generateVideoThumbnail(file.path);
					}
				}

				if (!image) {
					if (file.stream) {
						image = {
							data: file.stream as any,
							ext: file.ext,
							type: file.mime,
						};
					} else if (file.path) {
						const fileSize = file.size || 0;
						if (request.headers.range && fileSize > 0) {
							const range = request.headers.range as string;
							const parts = range.replace(/bytes=/, '').split('-');
							const start = parseInt(parts[0], 10);
							let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
							if (end > fileSize) {
								end = fileSize - 1;
							}
							const chunksize = end - start + 1;

							image = {
								data: fs.createReadStream(file.path, {
									start,
									end,
								}),
								ext: file.ext,
								type: file.mime,
							};

							reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
							reply.header('Accept-Ranges', 'bytes');
							reply.header('Content-Length', chunksize);
							reply.code(206);
						} else {
							image = {
								data: fs.createReadStream(file.path),
								ext: file.ext,
								type: file.mime,
							};
						}
					} else {
						throw new Error('No stream or path available for file');
					}
				}

				if ('pipe' in image.data && typeof image.data.pipe === 'function') {
					// image.dataがstreamなら、stream終了後にcleanup
					image.data.on('end', file.cleanup);
					image.data.on('close', file.cleanup);
				} else {
					// image.dataがstreamでないなら直ちにcleanup
					file.cleanup();
				}

				reply.header('Content-Type', FILE_TYPE_BROWSERSAFE.includes(image.type) ? image.type : 'application/octet-stream');
				reply.header('Content-Length', file.size || 0);
				reply.header('Cache-Control', 'max-age=31536000, immutable');
				reply.header('Content-Disposition',
					contentDisposition(
						'inline',
						correctFilename(file.filename, image.ext),
					),
				);
				return image.data;
			}

			if (file.fileRole !== 'original') {
				const filename = rename(file.filename, {
					suffix: file.fileRole === 'thumbnail' ? '-thumb' : '-web',
					// extname: file.ext ? `.${file.ext}` : '.unknown',
				}).toString();

				reply.header('Content-Type', FILE_TYPE_BROWSERSAFE.includes(file.mime) ? file.mime : 'application/octet-stream');
				reply.header('Cache-Control', 'max-age=31536000, immutable');
				reply.header('Content-Disposition', contentDisposition('inline', filename));

				const nonOriginalFileSize = file.file?.size || 0;
				const rangeStream = this.handleRangeRequest(file.path, nonOriginalFileSize, request.headers.range as string, reply);
				return rangeStream || fs.createReadStream(file.path);
			} else {
				reply.header('Content-Type', FILE_TYPE_BROWSERSAFE.includes(file.file?.type || '') ? (file.file?.type || 'application/octet-stream') : 'application/octet-stream');
				reply.header('Content-Length', file.file?.size || 0);
				reply.header('Cache-Control', 'max-age=31536000, immutable');
				reply.header('Content-Disposition', contentDisposition('inline', file.filename));

				const originalFileSize = file.file?.size || 0;
				const rangeStream = this.handleRangeRequest(file.path, originalFileSize, request.headers.range as string, reply);
				return rangeStream || fs.createReadStream(file.path);
			}
		} catch (e) {
			if ('cleanup' in file) file.cleanup();
			throw e;
		}
	}

	@bindThis
	private async proxyHandler(request: FastifyRequest<{ Params: { url: string; }; Querystring: { url?: string; }; }>, reply: FastifyReply) {
		const url = 'url' in request.query ? request.query.url : 'https://' + request.params.url;

		if (typeof url !== 'string') {
			reply.code(400);
			return;
		}

		// アバタークロップなど、どうしてもオリジンである必要がある場合
		const mustOrigin = 'origin' in request.query;

		if (this.config.externalMediaProxyEnabled && !mustOrigin) {
			// 外部のメディアプロキシが有効なら、そちらにリダイレクト

			reply.header('Cache-Control', 'public, max-age=259200'); // 3 days

			const url = new URL(`${this.config.mediaProxy}/${request.params.url || ''}`);

			for (const [key, value] of Object.entries(request.query)) {
				url.searchParams.append(key, value);
			}

			return await reply.redirect(
				url.toString(),
				301,
			);
		}

		if (!request.headers['user-agent']) {
			throw new StatusError('User-Agent is required', 400, 'User-Agent is required');
		} else if (request.headers['user-agent'].toLowerCase().indexOf('misskey/') !== -1) {
			throw new StatusError('Refusing to proxy a request from another proxy', 403, 'Proxy is recursive');
		}

		// Create temp file
		const file = await this.getStreamAndTypeFromUrl(url);
		if (file === '404') {
			reply.code(404);
			reply.header('Cache-Control', 'max-age=86400');
			return reply.sendFile('/dummy.png', assets);
		}

		if (file === '204') {
			reply.code(204);
			reply.header('Cache-Control', 'max-age=86400');
			return;
		}

		try {
			const isConvertibleImage = isMimeImage(file.mime, 'sharp-convertible-image-with-bmp');
			const isAnimationConvertibleImage = isMimeImage(file.mime, 'sharp-animation-convertible-image-with-bmp');

			if (
				'emoji' in request.query ||
				'avatar' in request.query ||
				'static' in request.query ||
				'preview' in request.query ||
				'badge' in request.query
			) {
				if (!isConvertibleImage) {
					// 画像でないなら404でお茶を濁す
					throw new StatusError('Unexpected mime', 404);
				}
			}

			let image: IImageStreamable | null = null;
			if ('emoji' in request.query || 'avatar' in request.query) {
				if (!isAnimationConvertibleImage && !('static' in request.query)) {
					image = {
						data: fs.createReadStream(file.path),
						ext: file.ext,
						type: file.mime,
					};
				} else {
					const data = (await sharpBmp(file.path, file.mime, { animated: !('static' in request.query) }))
						.resize({
							height: 'emoji' in request.query ? 128 : 320,
							withoutEnlargement: true,
						})
						.webp(webpDefault);

					image = {
						data,
						ext: 'webp',
						type: 'image/webp',
					};
				}
			} else if ('static' in request.query) {
				image = this.imageProcessingService.convertSharpToWebpStream(await sharpBmp(file.path, file.mime), 498, 422);
			} else if ('preview' in request.query) {
				image = this.imageProcessingService.convertSharpToWebpStream(await sharpBmp(file.path, file.mime), 200, 200);
			} else if ('badge' in request.query) {
				const mask = (await sharpBmp(file.path, file.mime))
					.resize(96, 96, {
						fit: 'contain',
						position: 'centre',
						withoutEnlargement: false,
					})
					.greyscale()
					.normalise()
					.linear(1.75, -(128 * 1.75) + 128) // 1.75x contrast
					.flatten({ background: '#000' })
					.toColorspace('b-w');

				const stats = await mask.clone().stats();

				if (stats.entropy < 0.1) {
					// エントロピーがあまりない場合は404にする
					throw new StatusError('Skip to provide badge', 404);
				}

				const data = sharp({
					create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
				})
					.pipelineColorspace('b-w')
					.boolean(await mask.png().toBuffer(), 'eor');

				image = {
					data: await data.png().toBuffer(),
					ext: 'png',
					type: 'image/png',
				};
			} else if (file.mime === 'image/svg+xml') {
				image = this.imageProcessingService.convertToWebpStream(file.path, 2048, 2048);
			} else if (!file.mime.startsWith('image/') || !FILE_TYPE_BROWSERSAFE.includes(file.mime)) {
				throw new StatusError('Rejected type', 403, 'Rejected type');
			}

			if (!image) {
				const proxyFileSize = file.file?.size || 0;
				if (request.headers.range && proxyFileSize > 0) {
					const range = request.headers.range as string;
					const parts = range.replace(/bytes=/, '').split('-');
					const start = parseInt(parts[0], 10);
					let end = parts[1] ? parseInt(parts[1], 10) : proxyFileSize - 1;
					if (end > proxyFileSize) {
						end = proxyFileSize - 1;
					}
					const chunksize = end - start + 1;

					image = {
						data: fs.createReadStream(file.path, {
							start,
							end,
						}),
						ext: file.ext,
						type: file.mime,
					};

					reply.header('Content-Range', `bytes ${start}-${end}/${proxyFileSize}`);
					reply.header('Accept-Ranges', 'bytes');
					reply.header('Content-Length', chunksize);
					reply.code(206);
				} else {
					image = {
						data: fs.createReadStream(file.path),
						ext: file.ext,
						type: file.mime,
					};
				}
			}

			if ('cleanup' in file) {
				if ('pipe' in image.data && typeof image.data.pipe === 'function') {
					// image.dataがstreamなら、stream終了後にcleanup
					image.data.on('end', file.cleanup);
					image.data.on('close', file.cleanup);
				} else {
					// image.dataがstreamでないなら直ちにcleanup
					file.cleanup();
				}
			}

			reply.header('Content-Type', image.type);
			reply.header('Cache-Control', 'max-age=31536000, immutable');
			reply.header('Content-Disposition',
				contentDisposition(
					'inline',
					correctFilename(file.filename, image.ext),
				),
			);
			return image.data;
		} catch (e) {
			if ('cleanup' in file) file.cleanup();
			throw e;
		}
	}

	@bindThis
	private async getStreamAndTypeFromUrl(url: string): Promise<
		{ state: 'remote'; fileRole?: 'thumbnail' | 'webpublic' | 'original'; file?: MiDriveFile; mime: string; ext: string | null; path: string; cleanup: () => void; filename: string; }
		| { state: 'stored_internal'; fileRole: 'thumbnail' | 'webpublic' | 'original'; file: MiDriveFile; filename: string; mime: string; ext: string | null; path: string; }
		| '404'
		| '204'
	> {
		if (url.startsWith(`${this.config.url}/files/`)) {
			const key = url.replace(`${this.config.url}/files/`, '').split('/').shift();
			if (!key) throw new StatusError('Invalid File Key', 400, 'Invalid File Key');

			return await this.getFileFromKey(key);
		}

		return await this.downloadAndDetectTypeFromUrl(url);
	}

	@bindThis
	private async downloadAndDetectTypeFromUrl(url: string): Promise<
		{ state: 'remote'; mime: string; ext: string | null; path: string; cleanup: () => void; filename: string; }
	> {
		const [path, cleanup] = await createTemp();
		try {
			const { filename } = await this.downloadService.downloadUrl(url, path);

			const { mime, ext } = await this.fileInfoService.detectType(path);

			return {
				state: 'remote',
				mime, ext,
				path, cleanup,
				filename,
			};
		} catch (e) {
			cleanup();
			throw e;
		}
	}

	@bindThis
	private async getFileFromKey(key: string): Promise<
		{ state: 'remote'; fileRole: 'thumbnail' | 'webpublic' | 'original'; file: MiDriveFile; filename: string; url: string; mime: string; ext: string | null; path: string; cleanup: () => void; stream?: NodeJS.ReadableStream; size?: number; }
		| { state: 'stored_internal'; fileRole: 'thumbnail' | 'webpublic' | 'original'; file: MiDriveFile; filename: string; mime: string; ext: string | null; path: string; }
		| '404'
		| '204'
	> {
		// Fetch drive file
		const file = await this.driveFilesRepository.createQueryBuilder('file')
			.where('file.accessKey = :accessKey', { accessKey: key })
			.orWhere('file.thumbnailAccessKey = :thumbnailAccessKey', { thumbnailAccessKey: key })
			.orWhere('file.webpublicAccessKey = :webpublicAccessKey', { webpublicAccessKey: key })
			.getOne();

		if (file == null) return '404';

		const isThumbnail = file.thumbnailAccessKey === key;
		const isWebpublic = file.webpublicAccessKey === key;

		if (!file.storedInternal) {
			if (file.isLink && file.uri) {
				const result = await this.downloadAndDetectTypeFromUrl(file.uri);
				file.size = (await fs.promises.stat(result.path)).size;	// DB file.sizeは正確とは限らないので
				return {
					...result,
					url: file.uri,
					fileRole: isThumbnail ? 'thumbnail' : isWebpublic ? 'webpublic' : 'original',
					file,
					filename: file.name,
				};
			} else {
				// Check if physicalKey exists for non-thumbnail/webpublic files
				if (!isThumbnail && !isWebpublic && !file.physicalKey) {
					return '404';
				}

				const result = await this.downloadFromS3(file, key);
				if (result === '404') return '404';
				return {
					...result,
					fileRole: isThumbnail ? 'thumbnail' : isWebpublic ? 'webpublic' : 'original',
					file,
					filename: file.name,
				};
			}
		}

		// For deduplicated files, use physicalKey to access the actual file
		// For original files, physicalKey equals accessKey, so this works for both cases
		let physicalPath: string;

		if (file.physicalKey && file.physicalKey !== file.accessKey) {
			const originalFile = await this.driveFilesRepository.createQueryBuilder('file')
				.where('file.physicalKey = :physicalKey', { physicalKey: file.physicalKey })
				.orderBy('file.id', 'ASC')
				.getOne();

			if (originalFile) {
				if (isThumbnail && originalFile.thumbnailAccessKey) {
					physicalPath = this.internalStorageService.resolvePath(originalFile.thumbnailAccessKey);
				} else if (isWebpublic && originalFile.webpublicAccessKey) {
					physicalPath = this.internalStorageService.resolvePath(originalFile.webpublicAccessKey);
				} else if (!isThumbnail && !isWebpublic && originalFile.accessKey) {
					physicalPath = this.internalStorageService.resolvePath(originalFile.accessKey);
				} else {
					physicalPath = this.internalStorageService.resolvePath(key);
				}
			} else {
				physicalPath = this.internalStorageService.resolvePath(key);
			}
		} else {
			physicalPath = this.internalStorageService.resolvePath(key);
		}

		if (isThumbnail || isWebpublic) {
			const { mime, ext } = await this.fileInfoService.detectType(physicalPath);
			return {
				state: 'stored_internal',
				fileRole: isThumbnail ? 'thumbnail' : 'webpublic',
				file,
				filename: file.name,
				mime, ext,
				path: physicalPath,
			};
		}

		return {
			state: 'stored_internal',
			fileRole: 'original',
			file,
			filename: file.name,
			// 古いファイルは修正前のmimeを持っているのでできるだけ修正してあげる
			mime: this.fileInfoService.fixMime(file.type),
			ext: null,
			path: physicalPath,
		};
	}

	@bindThis
	private async downloadFromS3(file: MiDriveFile, key: string): Promise<
		{ state: 'remote'; mime: string; ext: string | null; path: string; cleanup: () => void; filename: string; url: string; stream?: NodeJS.ReadableStream; size?: number; }
		| '404'
	> {
		try {
			const meta = await this.metasRepository.findOne({ where: {} });
			if (!meta || !meta.objectStorageBucket) {
				return '404';
			}

			const isThumbnail = file.thumbnailAccessKey === key;
			const isWebpublic = file.webpublicAccessKey === key;

			let s3Key: string;
			if (isThumbnail) {
				s3Key = file.thumbnailPhysicalKey || '';
				if (!s3Key) {
					this.logger.warn(`Thumbnail physical key not found for file ${file.id}`);
					return '404';
				}
			} else if (isWebpublic) {
				s3Key = file.webpublicPhysicalKey || '';
				if (!s3Key) {
					this.logger.warn(`Webpublic physical key not found for file ${file.id}`);
					return '404';
				}
			} else {
				s3Key = file.physicalKey || '';
				if (!s3Key) {
					this.logger.warn(`Physical key not found for file ${file.id}`);
					return '404';
				}
			}

			this.logger.debug(`Downloading S3 file: ${s3Key} for file ${file.id} (isThumbnail: ${isThumbnail}, isWebpublic: ${isWebpublic})`);

			this.logger.info(`Attempting to get S3 object: bucket=${meta.objectStorageBucket}, key=${s3Key}`);
			const s3Object = await this.s3Service.getObjectStream(meta, s3Key);
			this.logger.info(`Successfully got S3 object: ${s3Key}, contentLength=${s3Object.contentLength}`);

			let mime = file.type;
			let ext: string | null = null;

			if (s3Object.contentType && s3Object.contentType !== 'application/octet-stream') {
				mime = s3Object.contentType;
			}

			const nameMatch = file.name.match(/\.([^.]+)$/);
			if (nameMatch) {
				ext = nameMatch[1];
			} else if (mime.startsWith('image/')) {
				ext = mime.split('/')[1];
			}

			return {
				state: 'remote' as const,
				mime,
				ext,
				path: '',
				cleanup: () => {},
				filename: file.name,
				url: file.url,
				stream: s3Object.stream,
				size: s3Object.contentLength || file.size,
			};
		} catch (e) {
			this.logger.warn(`Failed to download S3 file: ${e}`);
			return '404';
		}
	}
}
