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
		/*
		const isWindows = process.platform === 'win32';
		const exeName = isWindows ? 'zip_safe.exe' : 'zip_safe';
		const zipSafePath = process.cwd() + '/tools/' + exeName;
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
					const reason = parsed?.reason ?? null;
					resolve({ result, reason });
				} catch (e) {
					reject(new Error(`Failed to parse JSON output: ${e}`));
				}
			});

			newProcess.on('error', (err) => {
				reject(err);
			});
		});
		 */
		return { result: true, reason: 'Retain this function for future use' };
	}

	@bindThis
	public async checkContainer(): Promise<{ in_container: boolean; confidence: number }> {
		const checker = process.cwd() + '/tools/detect';
		const isWindows = process.platform === 'win32';
		return new Promise((resolve, reject) => {
			if (!existsSync(checker) || isWindows) {
				console.log(`Checker not found, ignored.`);
				return resolve({ in_container: false, confidence: 100 });
			}

			const newProcess = spawn(checker, ['--json']);
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
					const in_container = Boolean(parsed.in_container);
					const confidence = Number(parsed.confidence);
					resolve({ in_container, confidence });
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
