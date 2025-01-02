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

const path = Path.resolve(_dirname, '../../../../files/ip2l');
if (!fs.existsSync(path)) {
	fs.mkdirSync(path, { recursive: true });
}
const newFileName = '/ipdb.bin';

@Injectable()
export class IP2LocationService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private downloadService: DownloadService
	) {}

	@bindThis
	public async syncIP2L(): Promise<void> {
		if (this.meta.ip2lAuthKey) {
			try {
				const dbUrl = `https://www.ip2location.com/download/?token=${ this.meta.ip2lAuthKey }&file=${ this.meta.ip2lIsPro ? "DB1BINIPV6" : "DB1LITEBINIPV6" }`;
				const zipFilePath = path + '/file.zip';
				await this.downloadService.downloadUrl(dbUrl, zipFilePath, true);
				await this.extractAndRenameBinFile(zipFilePath, path, newFileName);
			} catch (e: unknown) {
				if (e instanceof Error) {
					console.error(e);
					return;
				} else {
					throw new Error('An unknown error occurred.');
				}
			}
		}
	}

	@bindThis
	public async checkIP(ip: string): Promise<boolean> {
		const ip2location = new IP2Location();
		const tools = new IPTools();
		if (tools.isIPV4(ip) || tools.isIPV6(ip)) {
			if (!this.meta.exemptIP.includes(ip)) {
				try {
					ip2location.openAsync(path + newFileName).then(() => {
							ip2location.getAllAsync(ip).then((result: any): boolean => {
								const finalResult = result.countryShort;
								if (finalResult !== 'MISSING_FILE') {
									return !this.meta.banCountry.includes(finalResult);
								}
								console.log("MISSING_FILE");
								return true;
							});
					});
				} catch (error) {
					console.error(error);
					return true;
				}
			}
			return true;
		}
		console.log("Not a valid IP");
		return true;
	}

	private async extractAndRenameBinFile(zipFilePath: string, outputDir: string, newFileName: string): Promise<void> {
		try {
			const zipBuffer = await fs.promises.readFile(zipFilePath);

			const zipReader = ZipReader.withDestinationPath(outputDir);
			zipReader.viaBuffer(zipBuffer);

			const fileNames = await fs.promises.readdir(outputDir);

			let extracted = false;

			for (const fileName of fileNames) {
				if (fileName.toLowerCase().endsWith('.bin')) {
					const oldFilePath = Path.join(outputDir, fileName);
					const newFilePath = Path.join(outputDir, newFileName);

					await fs.promises.rename(oldFilePath, newFilePath);

					extracted = true;
					break;
				}
			}

			await fs.promises.unlink(zipFilePath);

			if (!extracted) {
				console.log('No .BIN file found in the ZIP archive.');
			}
		} catch (error) {
			console.error('Error during extraction:', error);
		}
	}
}
