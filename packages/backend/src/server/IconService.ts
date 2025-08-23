/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { createTemp } from '@/misc/create-temp.js';
import { DownloadService } from '@/core/DownloadService.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';

interface IconCacheItem {
	data: Buffer;
	mime: string;
	timestamp: number;
}

@Injectable()
export class IconService {
	private iconCache = new Map<string, IconCacheItem>();
	private readonly CACHE_TTL = 86400 * 1000; // 24 hours in milliseconds

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private downloadService: DownloadService,
	) {}

	@bindThis
	private guessMimeType(filename: string): string {
		const ext = path.extname(filename).toLowerCase().slice(1);
		const mimeTypes: Record<string, string> = {
			'png': 'image/png',
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'gif': 'image/gif',
			'svg': 'image/svg+xml',
			'webp': 'image/webp',
			'ico': 'image/x-icon',
			'bmp': 'image/bmp'
		};
		return mimeTypes[ext] || 'image/x-icon';
	}

	@bindThis
	private isCacheValid(timestamp: number): boolean {
		return Date.now() - timestamp < this.CACHE_TTL;
	}

	@bindThis
	private extractSizeFromPath(iconPath: string): number {
		const matches = iconPath.match(/(\d+)x\d+/);
		if (matches) {
			return parseInt(matches[1], 10);
		}

		if (iconPath.includes('apple-touch-icon-precomposed') || iconPath === '/apple-touch-icon.png') {
			return 192;
		}

		return 192;
	}

	@bindThis
	private getBestAppleIconUrl(requestedSize?: number): string | null {
		const targetSize = requestedSize || 180;

		const availableIcons = [
			{ url: this.meta.app512IconUrl, size: 512 },
			{ url: this.meta.app192IconUrl, size: 192 }
		].filter(icon => icon.url);

		if (availableIcons.length === 0) {
			return null;
		}

		const exactMatch = availableIcons.find(icon => icon.size === targetSize);
		if (exactMatch) {
			return exactMatch.url;
		}

		const largerIcons = availableIcons
			.filter(icon => icon.size >= targetSize)
			.sort((a, b) => a.size - b.size);

		if (largerIcons.length > 0) {
			return largerIcons[0].url;
		}

		const sortedIcons = availableIcons.sort((a, b) => b.size - a.size);
		return sortedIcons[0].url;
	}

	@bindThis
	private async fetchIconFromUrl(url: string): Promise<{ data: Buffer; mime: string }> {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			const [temp, cleanup] = await createTemp();
			try {
				const downloadResult = await this.downloadService.downloadUrl(url, temp);
				const mime = this.guessMimeType(downloadResult.filename || url);
				const data = await fs.promises.readFile(temp);
				return {
					data,
					mime: mime || this.guessMimeType(url)
				};
			} finally {
				cleanup();
			}
		} else {
			const filePath = url.startsWith('/') ? url.slice(1) : url;
			const fullPath = path.resolve('files', filePath);
			const data = await fs.promises.readFile(fullPath);
			const mime = this.guessMimeType(fullPath);
			return { data, mime };
		}
	}

	@bindThis
	private async handleIconRequest(
		request: FastifyRequest,
		reply: FastifyReply,
		iconType: 'favicon' | 'apple-touch-icon',
		requestedPath?: string
	): Promise<void> {
		try {
			let iconUrl: string | null = null;

			if (iconType === 'favicon') {
				iconUrl = this.meta.iconUrl || this.meta.logoImageUrl;
			} else {
				const requestedSize = requestedPath ? this.extractSizeFromPath(requestedPath) : undefined;
				iconUrl = this.getBestAppleIconUrl(requestedSize);
			}

			if (!iconUrl) {
				reply.code(404).send('Icon not found');
				return;
			}

			const cacheKey = `${iconType}:${iconUrl}`;
			const cached = this.iconCache.get(cacheKey);
			if (cached && this.isCacheValid(cached.timestamp)) {
				reply.type(cached.mime);
				reply.header('Cache-Control', 'public, max-age=86400');
				reply.header('Vary', 'Accept');
				return reply.send(cached.data);
			}

			const result = await this.fetchIconFromUrl(iconUrl);

			this.iconCache.set(cacheKey, {
				data: result.data,
				mime: result.mime,
				timestamp: Date.now()
			});

			reply.type(result.mime);
			reply.header('Cache-Control', 'public, max-age=86400');
			reply.header('Vary', 'Accept');
			return reply.send(result.data);
		} catch (error) {
			console.warn(`Failed to fetch ${iconType}:`, error);
			reply.code(404).send('Failed to fetch icon');
			return;
		}
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		const hasFaviconConfig = !!(this.meta.iconUrl || this.meta.logoImageUrl);
		const hasAppleIconConfig = !!(this.meta.app192IconUrl || this.meta.app512IconUrl || this.meta.iconUrl);

		if (hasFaviconConfig) {
			fastify.get('/favicon.ico', async (request, reply) => {
				return this.handleIconRequest(request, reply, 'favicon');
			});

			fastify.get('/icon-:size.png', async (request: FastifyRequest<{ Params: { size: string } }>, reply) => {
				return this.handleIconRequest(request, reply, 'favicon');
			});

			const manifestIconSizes = ['16', '32', '48', '64', '96', '128', '192', '256', '384', '512'];
			manifestIconSizes.forEach(size => {
				fastify.get(`/icon-${size}x${size}.png`, async (request, reply) => {
					return this.handleIconRequest(request, reply, 'favicon');
				});
			});

			const tileIconPaths = [
				'/mstile-70x70.png',
				'/mstile-144x144.png',
				'/mstile-150x150.png',
				'/mstile-310x150.png',
				'/mstile-310x310.png'
			];

			tileIconPaths.forEach(iconPath => {
				fastify.get(iconPath, async (request, reply) => {
					return this.handleIconRequest(request, reply, 'favicon');
				});
			});

			fastify.get('/safari-pinned-tab.svg', async (request, reply) => {
				return this.handleIconRequest(request, reply, 'favicon');
			});

			fastify.get('/android-chrome-:size.png', async (request: FastifyRequest<{ Params: { size: string } }>, reply) => {
				return this.handleIconRequest(request, reply, 'favicon');
			});

			const faviconVariants = [
				'/favicon-16x16.png',
				'/favicon-32x32.png',
				'/favicon-96x96.png'
			];

			faviconVariants.forEach(iconPath => {
				fastify.get(iconPath, async (request, reply) => {
					return this.handleIconRequest(request, reply, 'favicon');
				});
			});
		}

		if (hasAppleIconConfig) {
			const appleIconPaths = [
				'/apple-touch-icon.png',
				'/apple-touch-icon-57x57.png',
				'/apple-touch-icon-60x60.png',
				'/apple-touch-icon-72x72.png',
				'/apple-touch-icon-76x76.png',
				'/apple-touch-icon-114x114.png',
				'/apple-touch-icon-120x120.png',
				'/apple-touch-icon-144x144.png',
				'/apple-touch-icon-152x152.png',
				'/apple-touch-icon-180x180.png',
				'/apple-touch-icon-precomposed.png'
			];

			appleIconPaths.forEach(iconPath => {
				fastify.get(iconPath, async (request, reply) => {
					return this.handleIconRequest(request, reply, 'apple-touch-icon', iconPath);
				});
			});
		}

		setInterval(() => {
			const now = Date.now();
			for (const [key, item] of this.iconCache.entries()) {
				if (now - item.timestamp > this.CACHE_TTL) {
					this.iconCache.delete(key);
				}
			}
		}, 3600 * 1000);

		done();
	}

	@bindThis
	public clearCache(): void {
		this.iconCache.clear();
		console.log('Icon cache cleared');
	}

	@bindThis
	public getCacheStats(): { size: number; keys: string[] } {
		return {
			size: this.iconCache.size,
			keys: Array.from(this.iconCache.keys())
		};
	}
}
