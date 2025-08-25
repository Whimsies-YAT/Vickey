/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Locale } from '../../../locales/index.js';

type BootLoaderLocaleBody = Locale['_bootErrors'] & { reload: Locale['reload'] };

function safeSetStorageItem(key: string, data: any): boolean {
	try {
		const jsonString = JSON.stringify(data);
		localStorage.setItem(key, jsonString);

		const stored = localStorage.getItem(key);
		if (stored !== jsonString) {
			console.error(`Storage verification failed for ${key}, stored data length: ${stored?.length}, original: ${jsonString.length}`);
			return false;
		}

		return true;
	} catch (error) {
		console.error(`Failed to store bootloader data for ${key}:`, error);
		return false;
	}
}

export function storeBootloaderErrors(locale: BootLoaderLocaleBody) {
	const success = safeSetStorageItem('bootloaderLocales', locale);
	if (!success) {
		console.warn('Failed to store bootloader errors, using minimal fallback');
		try {
			const minimalData = {
				title: locale.title || 'Error',
				reload: locale.reload || 'Reload'
			};
			localStorage.setItem('bootloaderLocales', JSON.stringify(minimalData));
		} catch (fallbackError) {
			console.error('Even minimal bootloader storage failed:', fallbackError);
		}
	}
}
