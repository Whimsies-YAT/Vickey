/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

declare module '@xenova/transformers' {
	export const env: {
		cacheDir: string;
		allowLocalModels: boolean;
		allowRemoteModels: boolean;
		useBrowserCache: boolean;
		useFS: boolean;
		backends: {
			onnx: {
				wasm: {
					numThreads: number;
				};
			};
		};
	};

	export function pipeline(
		task: 'feature-extraction',
		model: string,
		options?: {
			quantized?: boolean;
			cache_dir?: string;
			local_files_only?: boolean;
		},
	): Promise<(text: string, options?: { pooling?: string; normalize?: boolean; }) => Promise<{
		data: ArrayLike<number>;
	}>>;
}
