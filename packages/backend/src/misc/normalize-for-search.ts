/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Try to load native module
let nativeModule: { normalizeForSearch: (text: string) => string } | null = null;

try {
	// Dynamic import for ESM native wrapper
	// @ts-expect-error dynamic import
	nativeModule = await import('../native/index.js');
} catch {
	// Native module not available, will use JS fallback
}

export function normalizeForSearch(tag: string): string {
	// Use native implementation if available
	if (nativeModule?.normalizeForSearch) {
		return nativeModule.normalizeForSearch(tag);
	}

	// JavaScript fallback
	return tag.normalize('NFKC').toLowerCase();
}
