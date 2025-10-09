/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import Logger from '@/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffi from 'ffi-napi';
import ref from 'ref-napi';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@Injectable()
export class PdqService {
	private logger: Logger = new Logger('PdqService');
	private yumeLib: any = null;
	private isAvailable: boolean = false;

	constructor() {
		this.initializeLibrary();
	}

	@bindThis
	private initializeLibrary() {
		try {
			let libFileName: string;
			if (process.platform === 'linux') {
				libFileName = 'libyume_pdq.so';
			} else if (process.platform === 'darwin') {
				libFileName = 'libyume_pdq.dylib';
			} else if (process.platform === 'win32') {
				libFileName = 'yume_pdq.dll';
			} else {
				this.logger.warn(`Unsupported platform: ${process.platform}. PDQ hashing will be disabled.`);
				return;
			}

			const libPath = path.join(__dirname, '../../lib', libFileName);

			if (!fs.existsSync(libPath)) {
				this.logger.warn(`yume-pdq library not found at ${libPath}. PDQ hashing will be disabled. Run build-yume-pdq.sh to enable it.`);
				return;
			}

			this.yumeLib = ffi.Library(libPath, {
				'yume_pdq_hash_smart_kernel': ['float', [
					'pointer',
					'pointer',
					'pointer',
					'pointer',
					'pointer',
					'pointer',
				]]
			});

			this.isAvailable = true;
			this.logger.info('yume-pdq library loaded successfully');
		} catch (error) {
			this.logger.warn('Failed to load yume-pdq library. PDQ hashing will be disabled:', (error as Error));
			this.isAvailable = false;
		}
	}

	@bindThis
	public async generatePdqHash(imageBuffer: Buffer, width: number, height: number): Promise<string> {
		if (!this.isAvailable || !this.yumeLib) {
			throw new Error('PDQ service is not available');
		}

		return new Promise((resolve, reject) => {
			try {
				if (width !== 512 || height !== 512) {
					throw new Error(`PDQ requires 512x512 image, got ${width}x${height}`);
				}

				const f32Input = Buffer.alloc(512 * 512 * 4);
				for (let i = 0; i < 512 * 512; i++) {
					f32Input.writeFloatLE(imageBuffer[i], i * 4);
				}

				const threshold = Buffer.alloc(4);
				const output = Buffer.alloc(32);
				const buf1 = Buffer.alloc(128 * 128 * 4);
				const tmp = Buffer.alloc(128 * 4);
				const pdqf = Buffer.alloc(16 * 16 * 4);

				const quality = this.yumeLib.yume_pdq_hash_smart_kernel(
					f32Input,
					threshold,
					output,
					buf1,
					tmp,
					pdqf
				);

				this.logger.debug(`PDQ hash generated with quality: ${quality}`);
				const hashHex = output.toString('hex');
				resolve(hashHex);
			} catch (error) {
				this.logger.error('PDQ hash generation failed:', (error as Error));
				reject(error);
			}
		});
	}

	@bindThis
	public async generatePdqHashFromFile(filePath: string): Promise<string | null> {
		if (!this.isAvailable || !this.yumeLib) {
			return null;
		}

		try {
			const { data, info } = await sharp(filePath)
				.resize(512, 512, { fit: 'fill' })
				.grayscale()
				.raw()
				.toBuffer({ resolveWithObject: true });

			return await this.generatePdqHash(data, info.width, info.height);
		} catch (error) {
			this.logger.error('Failed to generate PDQ hash from file:', (error as Error));
			return null;
		}
	}

	@bindThis
	public calculateHammingDistance(hash1: string, hash2: string): number {
		if (hash1.length !== hash2.length) {
			throw new Error('Hash lengths must be equal');
		}

		let distance = 0;
		for (let i = 0; i < hash1.length; i += 2) {
			const byte1 = parseInt(hash1.substr(i, 2), 16);
			const byte2 = parseInt(hash2.substr(i, 2), 16);
			const xor = byte1 ^ byte2;

			let count = xor;
			while (count) {
				distance++;
				count &= count - 1;
			}
		}

		return distance;
	}

	@bindThis
	public areSimilar(hash1: string, hash2: string, threshold: number = 16): boolean {
		return this.calculateHammingDistance(hash1, hash2) <= threshold;
	}

	@bindThis
	public hashToVector(pdqHash: string): number[] {
		if (!pdqHash || pdqHash.length !== 64) {
			throw new Error('Invalid PDQ hash format');
		}

		const vector: number[] = [];
		for (let i = 0; i < pdqHash.length; i += 2) {
			const byte = parseInt(pdqHash.substr(i, 2), 16);
			for (let bit = 7; bit >= 0; bit--) {
				vector.push((byte >> bit) & 1);
			}
		}
		return vector;
	}
}
