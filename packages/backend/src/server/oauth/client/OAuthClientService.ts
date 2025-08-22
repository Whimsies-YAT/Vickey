/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';

export interface OAuthClientConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scope?: string[];
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userInfoEndpoint?: string;
	issuer?: string;
	jwksUri?: string;
	responseType?: 'code' | 'token' | 'id_token';
	grantType?: 'authorization_code' | 'client_credentials' | 'refresh_token';
	pkce?: boolean;
}

export interface AuthorizationRequest {
	state: string;
	codeVerifier?: string;
	nonce?: string;
	authUrl: string;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
	id_token?: string;
}

export interface UserInfo {
	sub: string;
	name?: string;
	given_name?: string;
	family_name?: string;
	email?: string;
	email_verified?: boolean;
	picture?: string;
	locale?: string;
	[key: string]: any;
}

@Injectable()
export class OAuthClientService {
	private readonly logger: Logger;
	private readonly stateCache = new Map<string, { data: any; expiresAt: number }>();

	constructor(
		private readonly httpRequestService: HttpRequestService,
		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('oauth-client');
	}

	/**
	 * Clean up expired states
	 */
	@bindThis
	private cleanupExpiredStates(): void {
		const now = Date.now();
		for (const [state, cached] of this.stateCache.entries()) {
			if (cached.expiresAt < now) {
				this.stateCache.delete(state);
			}
		}
	}

	/**
	 * Generate authorization URL for OAuth 2.0 / OIDC
	 */
	@bindThis
	public async generateAuthorizationUrl(config: OAuthClientConfig): Promise<AuthorizationRequest> {
		const state = this.generateRandomString(32);
		const nonce = this.generateRandomString(32);

		const authUrl = new URL(config.authorizationEndpoint);
		const params = new URLSearchParams();

		params.set('response_type', config.responseType || 'code');
		params.set('client_id', config.clientId);
		params.set('redirect_uri', config.redirectUri);
		params.set('state', state);

		if (config.scope && config.scope.length > 0) {
			params.set('scope', config.scope.join(' '));
		}

		let codeVerifier: string | undefined;
		if (config.pkce) {
			codeVerifier = this.generateCodeVerifier();
			const codeChallenge = this.generateCodeChallenge(codeVerifier);
			params.set('code_challenge', codeChallenge);
			params.set('code_challenge_method', 'S256');
		}

		// For OIDC
		if (config.scope?.includes('openid')) {
			params.set('nonce', nonce);
		}

		authUrl.search = params.toString();

		// Cache state for validation
		this.stateCache.set(state, {
			data: {
				config,
				codeVerifier,
				nonce,
				timestamp: Date.now(),
			},
			expiresAt: Date.now() + (1000 * 60 * 10), // 10 minutes
		});

		// Clean up expired states
		this.cleanupExpiredStates();

		return {
			state,
			codeVerifier,
			nonce,
			authUrl: authUrl.toString(),
		};
	}

	/**
	 * Exchange authorization code for access token
	 */
	@bindThis
	public async exchangeCodeForToken(
		code: string,
		state: string,
	): Promise<TokenResponse> {
		const cached = this.stateCache.get(state);
		if (!cached || cached.expiresAt < Date.now()) {
			if (cached) this.stateCache.delete(state);
			throw new Error('Invalid or expired state');
		}

		const stateData = cached.data;
		this.stateCache.delete(state);

		const { config, codeVerifier } = stateData;

		const tokenUrl = new URL(config.tokenEndpoint);
		const body = new URLSearchParams();

		body.set('grant_type', 'authorization_code');
		body.set('client_id', config.clientId);
		body.set('client_secret', config.clientSecret);
		body.set('code', code);
		body.set('redirect_uri', config.redirectUri);

		if (codeVerifier) {
			body.set('code_verifier', codeVerifier);
		}

		try {
			const response = await this.httpRequestService.send(tokenUrl.toString(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'application/json',
				},
				body: body.toString(),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.error('Token exchange failed', { status: response.status, error: errorText });
				throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
			}

			const tokenData = await response.json() as TokenResponse;

			// State already cleaned up above

			return tokenData;
		} catch (error) {
			this.logger.error('Error exchanging code for token', { error });
			throw error;
		}
	}

	/**
	 * Refresh access token
	 */
	@bindThis
	public async refreshToken(
		config: OAuthClientConfig,
		refreshToken: string,
	): Promise<TokenResponse> {
		const tokenUrl = new URL(config.tokenEndpoint);
		const body = new URLSearchParams();

		body.set('grant_type', 'refresh_token');
		body.set('client_id', config.clientId);
		body.set('client_secret', config.clientSecret);
		body.set('refresh_token', refreshToken);

		try {
			const response = await this.httpRequestService.send(tokenUrl.toString(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'application/json',
				},
				body: body.toString(),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.error('Token refresh failed', { status: response.status, error: errorText });
				throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
			}

			return await response.json() as TokenResponse;
		} catch (error) {
			this.logger.error('Error refreshing token', { error });
			throw error;
		}
	}

	/**
	 * Get user information using access token
	 */
	@bindThis
	public async getUserInfo(
		config: OAuthClientConfig,
		accessToken: string,
	): Promise<UserInfo> {
		if (!config.userInfoEndpoint) {
			throw new Error('UserInfo endpoint not configured');
		}

		try {
			const response = await this.httpRequestService.send(config.userInfoEndpoint, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Accept': 'application/json',
				},
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.error('UserInfo request failed', { status: response.status, error: errorText });
				throw new Error(`UserInfo request failed: ${response.status} ${errorText}`);
			}

			return await response.json() as UserInfo;
		} catch (error) {
			this.logger.error('Error getting user info', { error });
			throw error;
		}
	}

	/**
	 * Revoke token
	 */
	@bindThis
	public async revokeToken(
		config: OAuthClientConfig,
		token: string,
		tokenTypeHint?: 'access_token' | 'refresh_token',
	): Promise<void> {
		// Construct revocation endpoint from token endpoint if not provided
		const tokenUrl = new URL(config.tokenEndpoint);
		const revokeUrl = new URL('/oauth/revoke', tokenUrl.origin);

		const body = new URLSearchParams();
		body.set('token', token);
		body.set('client_id', config.clientId);
		body.set('client_secret', config.clientSecret);

		if (tokenTypeHint) {
			body.set('token_type_hint', tokenTypeHint);
		}

		try {
			const response = await this.httpRequestService.send(revokeUrl.toString(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'application/json',
				},
				body: body.toString(),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.error('Token revocation failed', { status: response.status, error: errorText });
				throw new Error(`Token revocation failed: ${response.status} ${errorText}`);
			}
		} catch (error) {
			this.logger.error('Error revoking token', { error });
			throw error;
		}
	}

	/**
	 * Generate random string for state/nonce
	 */
	private generateRandomString(length: number): string {
		return randomBytes(length).toString('base64url');
	}

	/**
	 * Generate PKCE code verifier
	 */
	private generateCodeVerifier(): string {
		return randomBytes(32).toString('base64url');
	}

	/**
	 * Generate PKCE code challenge from verifier
	 */
	private generateCodeChallenge(verifier: string): string {
		return createHash('sha256')
			.update(verifier)
			.digest('base64url');
	}

	/**
	 * Validate state parameter
	 */
	@bindThis
	public async validateState(state: string): Promise<boolean> {
		const cached = this.stateCache.get(state);
		return !!(cached && cached.expiresAt > Date.now());
	}

	/**
	 * Get state data
	 */
	@bindThis
	public getStateData(state: string): any | null {
		const cached = this.stateCache.get(state);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.data;
		}
		return null;
	}
}
