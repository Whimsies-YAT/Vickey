/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { Injectable } from '@nestjs/common';
import { Mutex } from 'async-mutex';
import fetch from 'node-fetch';
import { bindThis } from '@/decorators.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

@Injectable()
export class AiService {
	private child: ChildProcess | null = null;
	private childReady = false;
	private pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();
	private restartTimeout: NodeJS.Timeout | null = null;

	constructor(
	) {
		this.startChild();
	}

	@bindThis
	private startChild() {
		if (this.child) return;

		const workerScript = `
			import fs from 'node:fs';
			import path from 'node:path';
			import readline from 'node:readline';
			import { pipeline, env, RawImage as _RawImage } from '@xenova/transformers';
			import os from 'node:os';

			let model = null;
			let RawImage = _RawImage;

			// Suppress stdout to keep channel clean for JSON
			const originalStdoutWrite = process.stdout.write.bind(process.stdout);
			process.stdout.write = (chunk, encoding, callback) => {
				// Only allow our JSON messages
				if (typeof chunk === 'string' && chunk.startsWith('{"type":')) {
					return originalStdoutWrite(chunk, encoding, callback);
				}
				// Redirect everything else to stderr
				return process.stderr.write(chunk, encoding, callback);
			};

			async function load() {
				try {
					const modelCacheDir = '${resolve(_dirname, '../../../../files/models-cache').replace(/\\/g, '/')}';
					if (!fs.existsSync(modelCacheDir)) {
						fs.mkdirSync(modelCacheDir, { recursive: true });
					}

					env.cacheDir = modelCacheDir;
					env.allowLocalModels = true;
					env.allowRemoteModels = true;
					env.backends.onnx.wasm.numThreads = Math.min(4, os.cpus().length);
					env.useBrowserCache = false;
					env.useFS = true;

					model = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector', {
						quantized: true,
						cache_dir: modelCacheDir,
					});

					process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
				} catch (err) {
					console.error('Worker load error:', err);
					process.stdout.write(JSON.stringify({ type: 'error', error: err.message }) + '\\n');
				}
			}

			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
				terminal: false
			});

			rl.on('line', async (line) => {
				if (!line) return;
				try {
					const msg = JSON.parse(line);
					if (msg.type === 'detect') {
						if (!model) throw new Error('Model not loaded');

						// We receive a file path
						const results = await model(msg.source, { topk: 5 });
						const nsfwScore = results.find(x => x.label === 'nsfw')?.score || 0;

						const result = {
							sensitive: nsfwScore > msg.sensitiveThreshold,
							porn: nsfwScore > msg.pornThreshold,
							probability: nsfwScore,
						};

						process.stdout.write(JSON.stringify({ type: 'result', id: msg.id, result }) + '\\n');
					}
				} catch (err) {
					console.error('Worker process error:', err);
					// Try to send error back if we have an ID, otherwise just log
				}
			});

			load();
		`;

		try {
			this.child = spawn(process.execPath, ['--input-type=module', '--no-warnings', '-e', workerScript], {
				stdio: ['pipe', 'pipe', 'inherit'],
				cwd: _dirname, // Set CWD to ensure imports work if relative
			});

			const rl = readline.createInterface({
				input: this.child.stdout!,
				terminal: false,
			});

			rl.on('line', (line: string) => {
				try {
					const msg = JSON.parse(line);
					if (msg.type === 'ready') {
						this.childReady = true;
					} else if (msg.type === 'result') {
						const req = this.pendingRequests.get(msg.id);
						if (req) {
							req.resolve(msg.result);
							this.pendingRequests.delete(msg.id);
						}
					} else if (msg.type === 'error') {
						console.error('NSFW Child reported error:', msg.error);
					}
				} catch (e) {
					console.error('Failed to parse child message:', line, e);
				}
			});

			this.child.on('error', (err) => {
				console.error('NSFW Child process error:', err);
				this.restartChild();
			});

			this.child.on('exit', (code, signal) => {
				if (code !== 0 && signal !== 'SIGTERM') {
					console.error(`NSFW Child process exited with code ${code} signal ${signal}`);
					this.restartChild();
				}
			});
		} catch (e) {
			console.error('Failed to spawn NSFW child:', e);
		}
	}

	@bindThis
	private restartChild() {
		if (this.child) {
			this.child.kill();
			this.child = null;
		}
		this.childReady = false;
		// Reject all pending
		for (const [id, req] of this.pendingRequests) {
			req.reject(new Error('Worker process restarted'));
		}
		this.pendingRequests.clear();

		if (this.restartTimeout) clearTimeout(this.restartTimeout);
		this.restartTimeout = setTimeout(() => {
			this.startChild();
		}, 1000);
	}

	@bindThis
	public async detectSensitive(source: string | Buffer, sensitiveThreshold = 0.5, pornThreshold = 0.8): Promise<{ sensitive: boolean, porn: boolean, probability: number } | null> {
		if (!this.childReady || !this.child) return null;

		const id = Math.random().toString(36).substring(2);
		let tempFilePath: string | null = null;

		try {
			let input = source;
			if (Buffer.isBuffer(source)) {
				const os = await import('os');
				const path = await import('path');
				const tempDir = os.tmpdir();
				tempFilePath = path.join(tempDir, `nsfw-detect-${Date.now()}-${id}.png`);
				await fs.promises.writeFile(tempFilePath, source);
				input = tempFilePath;
			}

			const result = await new Promise<any>((resolve, reject) => {
				this.pendingRequests.set(id, { resolve, reject });

				const msg = JSON.stringify({ type: 'detect', id, source: input, sensitiveThreshold, pornThreshold }) + '\n';
				this.child?.stdin?.write(msg);

				// Timeout
				setTimeout(() => {
					if (this.pendingRequests.has(id)) {
						this.pendingRequests.delete(id);
						reject(new Error('NSFW detection timed out'));
					}
				}, 10000);
			});

			console.log(`NSFW Detection [${id}]:`, result);
			return result;
		} catch (err) {
			console.error('AiService detectSensitive error:', err);
			return null;
		} finally {
			if (tempFilePath) {
				await fs.promises.unlink(tempFilePath).catch(() => {});
			}
		}
	}

	// @bindThis
	// private async getCpuFlags(): Promise<string[]> {
	// 	const si = await import('systeminformation');
	// 	const str = await si.cpuFlags();
	// 	return str.split(/\s+/);
	// }
}
