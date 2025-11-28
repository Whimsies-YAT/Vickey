/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { silentTokenRefresh } from '@/utility/auto-token-regenerate.js';

export const pendingApiRequestsCount = ref(0);

// Check if running in Capacitor (mobile app)
const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
console.log('[Mobile] Capacitor detection:', {
	isCapacitor,
	hasCapacitor: !!(window as any).Capacitor,
	isNative: (window as any).Capacitor?.isNativePlatform?.(),
});

// Mobile-optimized fetch using native HTTP (bypasses CORS)
export async function capacitorFetch(url: string, options: RequestInit = {}): Promise<Response> {
	console.log('[Mobile] Using Capacitor HTTP for:', url);

	// Use global Capacitor object (injected by Capacitor runtime)
	const CapacitorHttp = (window as any).Capacitor?.PluginHeaders?.CapacitorHttp || (window as any).Capacitor?.Plugins?.CapacitorHttp;

	if (!CapacitorHttp) {
		console.error('[Mobile] CapacitorHttp not available, falling back to fetch');
		return window.fetch(url, options);
	}

	try {
		const response = await CapacitorHttp.request({
			url,
			method: options.method || 'GET',
			headers: options.headers as Record<string, string> || {},
			data: options.body ? JSON.parse(options.body as string) : undefined,
		});

		console.log('[Mobile] Capacitor HTTP response:', response.status, url);

		const nullBodyStatuses = [204, 205, 304];
		const hasBody = !nullBodyStatuses.includes(response.status);

		if (hasBody && response.data !== null && response.data !== undefined) {
			const bodyText = typeof response.data === 'string'
				? response.data
				: JSON.stringify(response.data);

			return new Response(bodyText, {
				status: response.status,
				statusText: response.status.toString(),
				headers: new Headers(response.headers),
			});
		} else {
			return new Response(null, {
				status: response.status,
				statusText: response.status.toString(),
				headers: new Headers(response.headers),
			});
		}
	} catch (error) {
		console.error('[Mobile] Capacitor HTTP failed:', error, url);
		throw error;
	}
}

// Implements Misskey.api.ApiClient.request
export function misskeyApi<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data?: P & { i?: string | null; },
	token?: string | null | undefined,
	signal?: AbortSignal,
	returnResponse?: false
): Promise<_ResT>;
export function misskeyApi<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P & { i?: string | null; },
	token: string | null | undefined,
	signal: AbortSignal | undefined,
	returnResponse: true
): Promise<Response>;
export function misskeyApi<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data?: P & { i?: string | null; },
	token?: string | null | undefined,
	signal?: AbortSignal,
	returnResponse?: boolean
): Promise<_ResT | Response> {
	if (endpoint.includes('://')) throw new Error('invalid endpoint');
	pendingApiRequestsCount.value++;

	const onFinally = () => {
		pendingApiRequestsCount.value--;
	};

	const promise = new Promise<_ResT | Response>((resolve, reject) => {
		const requestData = (data ?? {}) as P & { i?: string | null; };

		// Append a credential
		if ($i) requestData.i = $i.token;
		if (token !== undefined) requestData.i = token;
		let bodyJSON;
		try {
			bodyJSON = safeStringify(requestData);
		} catch (error) {
			console.error(error, requestData, endpoint);
			return;
		}

		// Send request (use native HTTP on mobile to bypass CORS)
		const fetchFn = isCapacitor ? capacitorFetch : window.fetch.bind(window);
		fetchFn(`${apiUrl}/${endpoint}`, {
			method: 'POST',
			body: bodyJSON,
			credentials: 'omit',
			cache: 'no-cache',
			headers: {
				'Content-Type': 'application/json',
			},
			signal,
		}).then(async (res) => {
			const needsRefresh = res.headers.get('X-Token-Needs-Refresh');
			if (needsRefresh === 'true') {
				console.log('Backend indicated token needs refresh');
				silentTokenRefresh().catch(error => {
					console.warn('Background token refresh failed:', error);
				});
			}

			if (returnResponse) {
				resolve(res);
			} else {
				const body = res.status === 204 ? null : await res.json();
				if (res.status === 200) {
					resolve(body);
				} else if (res.status === 204) {
					resolve(undefined as _ResT); // void -> undefined
				} else {
					if (body.error && body.error.id === 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14') {
						// Only clear localStorage and reload if this is the current user's token
						if ($i && (token === undefined || token === $i.token)) {
							localStorage.clear();
							window.location.reload();
							return;
						} else {
							// Don't immediately clear localStorage and reload during account switching
							// Let the account switching logic handle the error gracefully
							console.warn('Authentication failed for non-current account, token may be expired:', body.error);
						}
					}
					reject(body.error);
				}
			}
		}).catch(reject);
	});

	promise.then(onFinally, onFinally);

	return promise;
}

function safeStringify(obj) {
	const seen = new Set();
	return JSON.stringify(obj, (key, value) => {
		if (value != null && typeof value === 'object') {
			if (seen.has(value)) {
				return undefined;
			}
			seen.add(value);
		}
		return value;
	});
}

// Implements Misskey.api.ApiClient.request
export function misskeyApiGet<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data?: P,
	returnResponse?: false
): Promise<_ResT>;
export function misskeyApiGet<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P,
	returnResponse: true
): Promise<Response>;
export function misskeyApiGet<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data?: P,
	returnResponse: boolean = false
): Promise<_ResT | Response> {
	pendingApiRequestsCount.value++;

	const onFinally = () => {
		pendingApiRequestsCount.value--;
	};

	const requestData = (data ?? {}) as Record<string, unknown>;
	const query = new URLSearchParams(requestData as Record<string, string>);

	const promise = new Promise<_ResT | Response>((resolve, reject) => {
		// Send request (use native HTTP on mobile to bypass CORS)
		const fetchFn = isCapacitor ? capacitorFetch : window.fetch.bind(window);
		fetchFn(`${apiUrl}/${endpoint}?${query}`, {
			method: 'GET',
			credentials: 'omit',
			cache: 'default',
		}).then(async (res) => {
			const needsRefresh = res.headers.get('X-Token-Needs-Refresh');
			if (needsRefresh === 'true') {
				console.log('Backend indicated token needs refresh');
				silentTokenRefresh().catch(error => {
					console.warn('Background token refresh failed:', error);
				});
			}

			if (returnResponse) {
				resolve(res);
			} else {
				const body = res.status === 204 ? null : await res.json();
				if (res.status === 200) {
					resolve(body);
				} else if (res.status === 204) {
					resolve(undefined as _ResT); // void -> undefined
				} else {
					if (body.error && body.error.id === 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14') {
						// Only clear localStorage and reload if this is the current user's token
						if ($i) {
							localStorage.clear();
							window.location.reload();
							return;
						}
					}
					reject(body.error);
				}
			}
		}).catch(reject);
	});

	promise.then(onFinally, onFinally);

	return promise;
}

