/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Check if running in Capacitor (mobile)
const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();

let serverUrl: string;
let address: URL;

if (isCapacitor) {
	// Mobile: Get server URL from meta tag for API/WS, keep frontend on localhost
	serverUrl = window.document.querySelector<HTMLMetaElement>('meta[property="instance_url"]')?.content || '';

	if (!serverUrl || serverUrl === '__SERVER_URL_PLACEHOLDER__') {
		throw new Error('Server URL not configured. Please restart the app.');
	}

	address = new URL(serverUrl);
} else {
	// Web: Use meta tag or current location
	// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
	serverUrl = window.document.querySelector<HTMLMetaElement>('meta[property="instance_url"]')?.content || window.location.href;
	address = new URL(serverUrl);
}

const siteName = window.document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;

export const isMobileApp = isCapacitor;
export const host = address.host;
export const hostname = address.hostname;
// For mobile: url stays as localhost (current location), API goes to server
export const url = isCapacitor ? window.location.origin : address.origin;
export const port = address.port;
// API always points to server
export const apiUrl = address.origin + '/api';
export const wsOrigin = address.origin;
export const lang = localStorage.getItem('lang') ?? 'en-US';
export const langs = _LANGS_;
export const version = _VERSION_;
export const instanceName = (siteName === 'Vickey' || siteName == null) ? host : siteName;
export const ui = localStorage.getItem('ui');
export const debug = localStorage.getItem('debug') === 'true';
export const isSafeMode = localStorage.getItem('isSafeMode') === 'true';
export const DIALOG_DELAY_MS = 5000;
export const codename = _CODENAME_.replace(/^[a-z]/, c => c.toUpperCase());
export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion)').matches;
