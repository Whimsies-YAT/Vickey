/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as Path from 'node:path';
import { ZipReader } from 'slacc';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { CacheService } from '@/core/CacheService.js';
import { DownloadService } from '@/core/DownloadService.js';
import type { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { DI } from "@/di-symbols.js";
import { IP2Location, IPTools } from 'ip2location-nodejs';
import is_ip_private from 'private-ip';
import { IP2Proxy } from 'ip2proxy-nodejs';
import * as Redis from 'ioredis';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const CONFIG = {
	path: Path.resolve(_dirname, '../../../../files/ip2l'),
	fileName: 'ipdb.bin',
	zipFileName: 'file.zip',
	proxyFileName: 'ipdbP.bin',
	proxyZipFileName: 'fileP.zip',
};

if (!fs.existsSync(CONFIG.path)) {
	fs.mkdirSync(CONFIG.path, { recursive: true });
}

@Injectable()
export class IP2LocationService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.meta)
		private meta: MiMeta,

		private cacheService: CacheService,
		private downloadService: DownloadService
	) {}

	@bindThis
	public async syncIP2L(auth: string | null = this.meta.ip2lAuthKey, pro: boolean = this.meta.ip2lIsPro): Promise<void> {
		if (!auth) return;

		const dbUrl = `https://www.ip2location.com/download/?token=${auth}&file=${pro ? "DB11BINIPV6" : "DB11LITEBINIPV6"}`;
		const zipFilePath = Path.join(CONFIG.path, CONFIG.zipFileName);

		try {
			await this.downloadService.downloadUrl(dbUrl, zipFilePath, true);
			await this.extractAndRenameBinFile(zipFilePath, CONFIG.path, CONFIG.fileName);
		} catch (error) {
			console.error(error instanceof Error ? error : new Error('Unknown error occurred.'));
		}
	}

	@bindThis
	public async syncIP2LProxy(auth: string | null = this.meta.ip2lAuthKey, pro: boolean = this.meta.ip2lIsPro): Promise<void> {
		if (!auth) return;

		const dbUrl = `https://www.ip2location.com/download/?token=${auth}&file=${pro ? "PX12BIN" : "PX12LITEBIN"}`;
		const zipFilePath = Path.join(CONFIG.path, CONFIG.proxyZipFileName);

		try {
			await this.downloadService.downloadUrl(dbUrl, zipFilePath, true);
			await this.extractAndRenameBinFile(zipFilePath, CONFIG.path, CONFIG.proxyFileName);
		} catch (error) {
			console.error(error instanceof Error ? error : new Error('Unknown error occurred.'));
		}
	}

	@bindThis
	public async checkIP(ip: string): Promise<boolean> {
		if (!(await this.isValidIP(ip))) return true;

		const cache = await this.cacheService.checkIPCache.get(ip);

		if (cache !== undefined) {
			return cache;
		}

		try {
			const result = await this.getIPDetails(ip);
			const finalResult = !this.meta.banCountry.includes(result.countryShort || '');
			await this.cacheService.checkIPCache.set(ip, finalResult);
			return finalResult;
		} catch (error) {
			console.error(error);
			return true;
		}
	}

	@bindThis
	public checkIPSync(ip: string, callback: (result: boolean) => void): void {
		this.checkIP(ip).then(callback).catch(() => callback(true));
	}

	@bindThis
	public async checkIPProxy(ip: string): Promise<Record<string, any>> {
		if (!(await this.isValidIP(ip))) return {};

		const REDIS_KEY = `ipProxyCheck:${ip}`;
		const CACHE_TTL = 3600;
		const LOCK_TTL = 5;

		const LOAD_SCRIPT = `
    local key = KEYS[1]
    local lockKey = key..':lock'
    local ttl = ARGV[1]
    local lockTtl = ARGV[2]

    local data = redis.call('GET', key)
    if data then return data end

    if redis.call('SET', lockKey, '1', 'NX', 'EX', lockTtl) then
      return 'load_required'
    end

    return 'wait'
  `;

		const result = await this.redisClient.eval(
			LOAD_SCRIPT,
			1,
			REDIS_KEY,
			CACHE_TTL.toString(),
			LOCK_TTL.toString()
		);

		if (result !== 'load_required' && result !== 'wait') {
			return JSON.parse(result as string);
		}

		const transformData = (data: any): any => {
			if (data && typeof data === "object") {
				for (const key in data) {
					if (data[key] === "MISSING FILE") {
						data[key] = "-";
					}
					if (key === "isProxy" && data[key] === -1) {
						data[key] = 0;
					}
					if (key === "fraudScore" && data[key] === "-") {
						data[key] = "0";
					}
				}
			}
			return data;
		};

		if (result === 'load_required') {
			try {
				const data = transformData(await this.getIPProxyDetails(ip));
				const jsonData = JSON.stringify(data);

				await this.redisClient
					.pipeline()
					.set(REDIS_KEY, jsonData, 'EX', CACHE_TTL)
					.del(`${REDIS_KEY}:lock`)
					.exec();

				return data;
			} catch (err) {
				await this.redisClient.del(`${REDIS_KEY}:lock`);
				throw err;
			}
		}

		let retry = 0;
		let waitTime = 50;
		while (retry++ < 10) {
			await new Promise(resolve => setTimeout(resolve, waitTime));
			waitTime *= 2;

			const cached = await this.redisClient.get(REDIS_KEY);
			if (cached) {
				try {
					return JSON.parse(cached);
				} catch (err) {
					break;
				}
			}
		}

		return transformData(await this.getIPProxyDetails(ip));
	}

	@bindThis
	public checkIPProxySync(ip: string, callback: (result: Record<string, any>) => void): void {
		const wrappedCallback = (result: Record<string, any>) => {
			try {
				callback(result);
			} catch (err) {
				console.error('Callback error:', err);
			}
		};

		this.checkIPProxy(ip)
			.then((result: Record<string, any>) => {
				wrappedCallback(result);
			})
			.catch((err) => {
				console.error(`IP check failed [${ip}]:`, err);
				wrappedCallback({ error: 'IP check failed', details: err.message });
			});
	}

	@bindThis
	public async checkLocation(ip: string): Promise<string[]> {
		if (!(await this.isValidIPPurge(ip))) return [];

		const cache = await this.cacheService.checkLocationCache.get(ip);

		if (cache !== undefined) {
			return cache;
		}

		try {
			const result = await this.getIPDetails(ip);

			const order = [
				'ip', 'ipNo', 'countryShort', 'countryLong',
				'region', 'city', 'zipCode', 'latitude',
				'longitude', 'timeZone'
			];

			const finalResult = order.map(key => {
				const value = result[key as keyof typeof result];
				return value !== undefined && value !== null ? value.toString() : '';
			});
			await this.cacheService.checkLocationCache.set(ip, finalResult);
			return finalResult;
		} catch (error) {
			console.error(error);
			return [];
		}
	}

	private async extractAndRenameBinFile(zipFilePath: string, outputDir: string, newFileName: string): Promise<void> {
		try {
			const zipBuffer = await fs.promises.readFile(zipFilePath);
			const zipReader = ZipReader.withDestinationPath(outputDir);
			zipReader.viaBuffer(zipBuffer);

			const binFile = (await fs.promises.readdir(outputDir))
				.find(file => file.toLowerCase().endsWith('.bin'));

			if (binFile) {
				await fs.promises.rename(Path.join(outputDir, binFile), Path.join(outputDir, newFileName));
			} else {
				console.warn('No .BIN file found in the ZIP archive.');
			}
		} catch (error) {
			console.error('Error during extraction:', error);
		} finally {
			await fs.promises.unlink(zipFilePath).catch(() => {
				console.warn('Failed to delete ZIP file:', zipFilePath);
			});
		}
	}

	private async isValidIP(ip: string): Promise<boolean> {
		const isPrivate = is_ip_private(ip);
		const tools = new IPTools();
		return (tools.isIPV4(ip) || tools.isIPV6(ip)) && !this.meta.exemptIP.includes(ip) && !isPrivate;
	}

	private async isValidIPPurge(ip: string): Promise<boolean> {
		const isPrivate = is_ip_private(ip);
		const tools = new IPTools();
		return (tools.isIPV4(ip) || tools.isIPV6(ip)) && !isPrivate;
	}

	private async getIPDetails(ip: string): Promise<Record<string, any>> {
		const ip2location = new IP2Location();
		await ip2location.openAsync(Path.join(CONFIG.path, CONFIG.fileName));
		return ip2location.getAllAsync(ip);
	}

	private async getIPProxyDetails(ip: string): Promise<Record<string, any>> {
		const ip2proxy = new IP2Proxy();
		await ip2proxy.openAsync(Path.join(CONFIG.path, CONFIG.proxyFileName));
		return ip2proxy.getAllAsync(ip);
	}
}
