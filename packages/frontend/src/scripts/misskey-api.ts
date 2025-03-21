/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import { apiUrl } from '@@/js/config.js';
import { $i } from '@/account.js';
export const pendingApiRequestsCount = ref(0);

export type Endpoint = keyof Misskey.Endpoints;

export type Request<E extends Endpoint> = Misskey.Endpoints[E]['req'];

export type AnyRequest<E extends Endpoint | (string & unknown)> =
	(E extends Endpoint ? Request<E> : never) | object;

export type Response<E extends Endpoint | (string & unknown), P extends AnyRequest<E>> =
	E extends Endpoint
	? P extends Request<E> ? Misskey.api.SwitchCaseResponseType<E, P> : never
	: object;

// Implements Misskey.api.ApiClient.request
export function misskeyApi<
	ResT = void,
	E extends Endpoint | NonNullable<string> = Endpoint,
	P extends AnyRequest<E> = E extends Endpoint ? Request<E> : never,
	_ResT = ResT extends void ? Response<E, P> : ResT,
>(
	endpoint: E,
	data: P & { i?: string | null; } = {} as any,
	token?: string | null | undefined,
	signal?: AbortSignal,
	returnResponse: boolean = false
): Promise<_ResT | Response> {
	if (endpoint.includes('://')) throw new Error('invalid endpoint');
	pendingApiRequestsCount.value++;

	const onFinally = () => {
		pendingApiRequestsCount.value--;
	};

	const promise = new Promise<_ResT | Response>((resolve, reject) => {
		// Append a credential
		if ($i) data.i = $i.token;
		if (token !== undefined) data.i = token;
		let bodyJSON;
		try {
			bodyJSON = safeStringify(data);
		} catch (error) {
			console.error(error, data, endpoint);
			return;
		}

		// Send request
		window.fetch(`${apiUrl}/${endpoint}`, {
			method: 'POST',
			body: bodyJSON,
			credentials: 'omit',
			cache: 'no-cache',
			headers: {
				'Content-Type': 'application/json',
			},
			signal,
		}).then(async (res) => {
			if (returnResponse) {
				resolve(res);
			} else {
				const body = res.status === 204 ? null : await res.json();
				if (res.status === 200) {
					resolve(body);
				} else if (res.status === 204) {
					resolve(undefined as _ResT); // void -> undefined
				} else {
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
	data: P = {} as any,
	returnResponse: boolean = false
): Promise<_ResT | Response> {
	pendingApiRequestsCount.value++;

	const onFinally = () => {
		pendingApiRequestsCount.value--;
	};

	const query = new URLSearchParams(data as any);

	const promise = new Promise<_ResT | Response>((resolve, reject) => {
		// Send request
		window.fetch(`${apiUrl}/${endpoint}?${query}`, {
			method: 'GET',
			credentials: 'omit',
			cache: 'default',
		}).then(async (res) => {
			if (returnResponse) {
				resolve(res);
			} else {
				const body = res.status === 204 ? null : await res.json();
				if (res.status === 200) {
					resolve(body);
				} else if (res.status === 204) {
					resolve(undefined as _ResT); // void -> undefined
				} else {
					reject(body.error);
				}
			}
		}).catch(reject);
	});

	promise.then(onFinally, onFinally);

	return promise;
}

