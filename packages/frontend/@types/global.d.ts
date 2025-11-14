/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type FIXME = any;

declare const _LANGS_: string[][];
declare const _VERSION_: string;
declare const _CODENAME_: string;
declare const _ENV_: string;
declare const _DEV_: boolean;
declare const _PERF_PREFIX_: string;

// for dev-mode
declare const _LANGS_FULL_: string[][];

// TagCanvas
interface Window {
	TagCanvas: any;
}

declare module 'wasm-game-of-life' {
	const init: () => Promise<void>;
	export class Universe {
		static new(width: number, height: number): Universe;
		width(): number;
		height(): number;
		randomize(density?: number): void;
		set_pattern(pattern: string, row: number, col: number): void;
		cells_js(): Uint8Array;
		render_to_rgba(maxPixels: number): Uint8Array;
		render_dimensions(maxPixels: number): { width: number; height: number };
		tick(): void;
		generation(): number;
		live_cell_count(): number;
		is_stable(): boolean;
		clear(): void;
		toggle_cell(row: number, col: number): void;
	}

	export default init;
}
