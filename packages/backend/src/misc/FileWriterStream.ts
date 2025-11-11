/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import { WritableStream } from 'node:stream/web';
import type { PathLike } from 'node:fs';

/**
 * `fs.createWriteStream()`相当のことを行う`WritableStream` (Web標準)
 */
export class FileWriterStream extends WritableStream<Uint8Array> {
	constructor(path: PathLike) {
		let file: fs.FileHandle | null = null;

		super({
			start: async () => {
				file = await fs.open(path, 'a');
			},
			write: async (chunk, controller) => {
				if (file === null) {
					controller.error();
					throw new Error('FileHandle is null');
				}

				try {
					await file.write(chunk);
				} catch (error) {
					await file?.close();
					file = null;
					throw error;
				}
			},
			close: async () => {
				if (file !== null) {
					await file.close();
					file = null;
				}
			},
			abort: async () => {
				if (file !== null) {
					await file.close();
					file = null;
				}
			},
		});
	}
}
