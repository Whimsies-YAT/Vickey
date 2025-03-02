/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

@Injectable()
export class SecurityCoreService {
	constructor() {}

	@bindThis
	public async checkZip(path: string): Promise<{ result: boolean; reason: string | null }> {
		const zipSafePath = process.cwd() + '/tools/zip_safe';
		return new Promise((resolve, reject) => {
			if (!existsSync(zipSafePath)) {
				console.log(`Checker not found, ignored.`);
				return resolve({ result: true, reason: null });
			}

			const newProcess = spawn(zipSafePath, [path]);
			let output = '';

			newProcess.stdout.on('data', (data: Buffer) => {
				output += data.toString();
			});

			newProcess.stderr.on('data', (data: Buffer) => {
				console.error('Binary stderr:', data.toString());
			});

			newProcess.on('close', (code: number) => {
				if (code !== 0) {
					return reject(new Error(`Binary process exited with code ${code}`));
				}
				try {
					const parsed = JSON.parse(output);
					const result = parsed.result;
					const reason = parsed.hasOwnProperty('reason') ? parsed.reason : null;
					resolve({ result, reason });
				} catch (e) {
					reject(new Error(`Failed to parse JSON output: ${e}`));
				}
			});

			newProcess.on('error', (err) => {
				reject(err);
			});
		});
	}
}
