/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang, version } from '@@/js/config.js';
import type { Locale } from 'i18n';

function safeGetStorageItem(key: string): any | null {
	try {
		const stored = localStorage.getItem(key);
		if (!stored) {
			return null;
		}

		if (stored.endsWith('"') || stored.endsWith('}')) {
			try {
				return JSON.parse(stored);
			} catch (parseError) {
				console.warn(`JSON parse failed for ${key}, data may be corrupted:`, parseError);
				return null;
			}
		} else {
			console.warn(`Stored data for ${key} appears to be truncated`);
			return null;
		}
	} catch (error) {
		console.error(`Failed to retrieve storage item ${key}:`, error);
		return null;
	}
}

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
		console.error(`Failed to store data for ${key}:`, error);
		return false;
	}
}

async function loadLocaleWithRetry(targetLang: string, maxRetries = 3): Promise<Locale | null> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await window.fetch(`/assets/locales/${targetLang}.${version}.json`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();

			if (!data || typeof data !== 'object') {
				throw new Error('Invalid locale data format');
			}

			safeSetStorageItem('locale', data);

			return data as Locale;
		} catch (error) {
			console.error(`Locale loading attempt ${attempt + 1} failed for ${targetLang}:`, error);

			if (attempt === maxRetries - 1) {
				const cachedLocale = safeGetStorageItem('locale');
				if (cachedLocale && typeof cachedLocale === 'object') {
					// TODO: Check if cached locale matches targetLang?
					console.warn('Using cached locale from localStorage');
					return cachedLocale as Locale;
				}

				console.warn('All locale loading attempts failed, returning null');
				return null;
			}

			await new Promise(resolve => window.setTimeout(resolve, 100 * Math.pow(2, attempt)));
		}
	}

	return null;
}

// ここはビルド時に const locale = JSON.parse("...") みたいな感じで置き換えられるので top-level await は消える
const primaryLocale = await loadLocaleWithRetry(lang);
export let locale: Locale | null = primaryLocale;

if (!locale && lang !== 'en-US') {
	console.warn('Falling back to en-US');
	locale = await loadLocaleWithRetry('en-US');
}

if (!locale && lang !== 'ja-JP') {
	console.warn('Falling back to ja-JP');
	locale = await loadLocaleWithRetry('ja-JP');
}

export function updateLocale(newLocale: Locale | null): void {
	locale = newLocale;
}
