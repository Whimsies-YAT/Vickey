/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import {
	AuthorizationCode,
	type AuthorizationTokenConfig,
	ModuleOptions,
} from 'simple-oauth2';
import pkceChallenge from 'pkce-challenge';
import * as htmlParser from 'node-html-parser';
import { beforeAll, beforeEach, describe, test } from 'vitest';
import { api, port, sendEnvUpdateRequest, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

const host = `http://127.0.0.1:${port}`;

const clientPort = port + 1;
const redirect_uri = `http://127.0.0.1:${clientPort}/redirect`;

interface AuthorizationParamsExtended {
	redirect_uri: string;
	scope: string | string[];
	state: string;
	code_challenge?: string;
	code_challenge_method?: string;
}

interface AuthorizationTokenConfigExtended extends AuthorizationTokenConfig {
	code_verifier: string | undefined;
}

function getMeta(html: string): { transactionId: string | undefined, clientName: string | undefined, clientLogo: string | undefined } {
	const doc = htmlParser.parse(`<div>${html}</div>`);
	return {
		transactionId: doc.querySelector('meta[name="misskey:oauth:transaction-id"]')?.attributes.content,
		clientName: doc.querySelector('meta[name="misskey:oauth:client-name"]')?.attributes.content,
		clientLogo: doc.querySelector('meta[name="misskey:oauth:client-logo"]')?.attributes.content,
	};
}

async function fetchDecisionFromResponse(response: Response, user: misskey.entities.SignupResponse, { cancel }: { cancel?: boolean } = {}): Promise<Response> {
	const { transactionId } = getMeta(await response.text());
	assert.ok(transactionId);

	return fetch(new URL('/oauth/decision', host), {
		method: 'post',
		body: new URLSearchParams({
			transaction_id: transactionId,
			login_token: user.token,
			cancel: cancel ? 'cancel' : '',
		}),
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
		},
	});
}

describe('OAuth (Confidential Client)', () => {
	let alice: misskey.entities.SignupResponse;
	let app: misskey.entities.App;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });

		// Create a confidential app
		const res = await api('app/create', {
			name: 'Confidential App',
			description: 'Test App',
			permission: ['write:notes'],
			callbackUrl: redirect_uri,
		}, { token: alice.token });

		assert.strictEqual(res.status, 200);
		app = res.body;
		assert.ok(app.secret);
	}, 1000 * 60 * 2);

	beforeEach(async () => {
		await sendEnvUpdateRequest({ key: 'MISSKEY_TEST_CHECK_IP_RANGE', value: '' });
	});

	test('Success with correct client_secret (Body)', async () => {
		const clientConfig: ModuleOptions<'client_id'> = {
			client: {
				id: app.id,
				secret: app.secret!,
			},
			auth: {
				tokenHost: host,
				tokenPath: '/oauth/token',
				authorizePath: '/oauth/authorize',
			},
			options: {
				authorizationMethod: 'body',
			},
		};

		const client = new AuthorizationCode(clientConfig);
		const { code_challenge, code_verifier } = await pkceChallenge(128);

		// 1. Authorize
		const response = await fetch(client.authorizeURL({
			redirect_uri,
			scope: 'write:notes',
			state: 'state',
			code_challenge,
			code_challenge_method: 'S256',
		} as AuthorizationParamsExtended));
		assert.strictEqual(response.status, 200);

		// 2. Decision
		const decisionResponse = await fetchDecisionFromResponse(response, alice);
		assert.strictEqual(decisionResponse.status, 302);
		const locationHeader = decisionResponse.headers.get('location');
		assert.ok(locationHeader);
		const code = new URL(locationHeader).searchParams.get('code');
		assert.ok(code);

		// 3. Token Exchange
		const token = await client.getToken({
			code,
			redirect_uri,
			code_verifier,
		} as AuthorizationTokenConfigExtended);

		assert.strictEqual(typeof token.token.access_token, 'string');
	});

	test('Success with correct client_secret (Basic Auth)', async () => {
		const clientConfig: ModuleOptions<'client_id'> = {
			client: {
				id: app.id,
				secret: app.secret!,
			},
			auth: {
				tokenHost: host,
				tokenPath: '/oauth/token',
				authorizePath: '/oauth/authorize',
			},
			options: {
				authorizationMethod: 'header',
			},
		};

		const client = new AuthorizationCode(clientConfig);
		const { code_challenge, code_verifier } = await pkceChallenge(128);

		// 1. Authorize
		const response = await fetch(client.authorizeURL({
			redirect_uri,
			scope: 'write:notes',
			state: 'state',
			code_challenge,
			code_challenge_method: 'S256',
		} as AuthorizationParamsExtended));
		assert.strictEqual(response.status, 200);

		// 2. Decision
		const decisionResponse = await fetchDecisionFromResponse(response, alice);
		assert.strictEqual(decisionResponse.status, 302);
		const locationHeader = decisionResponse.headers.get('location');
		assert.ok(locationHeader);
		const code = new URL(locationHeader).searchParams.get('code');
		assert.ok(code);

		// 3. Token Exchange
		const token = await client.getToken({
			code,
			redirect_uri,
			code_verifier,
		} as AuthorizationTokenConfigExtended);

		assert.strictEqual(typeof token.token.access_token, 'string');
	});

	test('Fail with missing client_secret', async () => {
		const clientConfig: ModuleOptions<'client_id'> = {
			client: {
				id: app.id,
				secret: '', // Missing secret
			},
			auth: {
				tokenHost: host,
				tokenPath: '/oauth/token',
				authorizePath: '/oauth/authorize',
			},
			options: {
				authorizationMethod: 'body',
			},
		};

		const client = new AuthorizationCode(clientConfig);
		const { code_challenge, code_verifier } = await pkceChallenge(128);

		// 1. Authorize
		const response = await fetch(client.authorizeURL({
			redirect_uri,
			scope: 'write:notes',
			state: 'state',
			code_challenge,
			code_challenge_method: 'S256',
		} as AuthorizationParamsExtended));
		assert.strictEqual(response.status, 200);

		// 2. Decision
		const decisionResponse = await fetchDecisionFromResponse(response, alice);
		assert.strictEqual(decisionResponse.status, 302);
		const locationHeader = decisionResponse.headers.get('location');
		assert.ok(locationHeader);
		const code = new URL(locationHeader).searchParams.get('code');
		assert.ok(code);

		// 3. Token Exchange (Should fail)
		await assert.rejects(client.getToken({
			code,
			redirect_uri,
			code_verifier,
		} as AuthorizationTokenConfigExtended), (err: any) => {
			// simple-oauth2 wraps the error
			// The server should return invalid_client
			return true;
		});
	});

	test('Fail with incorrect client_secret', async () => {
		const clientConfig: ModuleOptions<'client_id'> = {
			client: {
				id: app.id,
				secret: 'wrong_secret',
			},
			auth: {
				tokenHost: host,
				tokenPath: '/oauth/token',
				authorizePath: '/oauth/authorize',
			},
			options: {
				authorizationMethod: 'body',
			},
		};

		const client = new AuthorizationCode(clientConfig);
		const { code_challenge, code_verifier } = await pkceChallenge(128);

		// 1. Authorize
		const response = await fetch(client.authorizeURL({
			redirect_uri,
			scope: 'write:notes',
			state: 'state',
			code_challenge,
			code_challenge_method: 'S256',
		} as AuthorizationParamsExtended));
		assert.strictEqual(response.status, 200);

		// 2. Decision
		const decisionResponse = await fetchDecisionFromResponse(response, alice);
		assert.strictEqual(decisionResponse.status, 302);
		const locationHeader = decisionResponse.headers.get('location');
		assert.ok(locationHeader);
		const code = new URL(locationHeader).searchParams.get('code');
		assert.ok(code);

		// 3. Token Exchange (Should fail)
		await assert.rejects(client.getToken({
			code,
			redirect_uri,
			code_verifier,
		} as AuthorizationTokenConfigExtended), (err: any) => {
			return true;
		});
	});
});
