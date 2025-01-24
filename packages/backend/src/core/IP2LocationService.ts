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
import { DownloadService } from '@/core/DownloadService.js';
import type { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { DI } from "@/di-symbols.js";
import { IP2Location, IPTools } from 'ip2location-nodejs';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const CONFIG = {
	path: Path.resolve(_dirname, '../../../../files/ip2l'),
	fileName: 'ipdb.bin',
	zipFileName: 'file.zip',
};

if (!fs.existsSync(CONFIG.path)) {
	fs.mkdirSync(CONFIG.path, { recursive: true });
}

@Injectable()
export class IP2LocationService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

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
	public async checkIP(ip: string): Promise<boolean> {
		if (!(await this.isValidIP(ip))) return true;

		try {
			const result = await this.getIPDetails(ip);
			return !this.meta.banCountry.includes(result.countryShort || '');
		} catch (error) {
			console.error(error);
			return true;
		}
	}

	@bindThis
	public checkIPsync(ip: string, callback: (result: boolean) => void): void {
		this.checkIP(ip).then(callback).catch(() => callback(true));
	}

	@bindThis
	public async checkLocation(ip: string): Promise<string[]> {
		if (!(await this.isValidIP(ip))) return [];

		try {
			const result = await this.getIPDetails(ip);

			const order = [
				'ip', 'ipNo', 'countryShort', 'countryLong',
				'region', 'city', 'zipCode', 'latitude',
				'longitude', 'timeZone'
			];

			return order.map(key => {
				const value = result[key as keyof typeof result];
				return value !== undefined && value !== null ? value.toString() : '';
			});
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
		const tools = new IPTools();
		return (tools.isIPV4(ip) || tools.isIPV6(ip)) && !this.meta.exemptIP.includes(ip);
	}

	private async getIPDetails(ip: string): Promise<Record<string, any>> {
		const ip2location = new IP2Location();
		await ip2location.openAsync(Path.join(CONFIG.path, CONFIG.fileName));
		return ip2location.getAllAsync(ip);
	}
}
