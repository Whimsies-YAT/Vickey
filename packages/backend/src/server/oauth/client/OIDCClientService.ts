/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { OAuthClientService, type OAuthClientConfig, type TokenResponse, type UserInfo } from './OAuthClientService.js';

export interface OIDCConfiguration {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
	jwks_uri: string;
	registration_endpoint?: string;
	scopes_supported?: string[];
	response_types_supported: string[];
	response_modes_supported?: string[];
	grant_types_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
	subject_types_supported: string[];
	id_token_signing_alg_values_supported: string[];
	claims_supported?: string[];
	code_challenge_methods_supported?: string[];
}

export interface JWKSet {
	keys: JWK[];
}

export interface JWK {
	kty: string;
	use?: string;
	key_ops?: string[];
	alg?: string;
	kid?: string;
	x5u?: string;
	x5c?: string[];
	x5t?: string;
	'x5t#S256'?: string;
	// RSA keys
	n?: string;
	e?: string;
	// Symmetric keys
	k?: string;
	// Elliptic Curve keys
	crv?: string;
	x?: string;
	y?: string;
}

export interface IDTokenClaims {
	iss: string;
	sub: string;
	aud: string | string[];
	exp: number;
	iat: number;
	auth_time?: number;
	nonce?: string;
	at_hash?: string;
	c_hash?: string;
	name?: string;
	given_name?: string;
	family_name?: string;
	middle_name?: string;
	nickname?: string;
	preferred_username?: string;
	profile?: string;
	picture?: string;
	website?: string;
	email?: string;
	email_verified?: boolean;
	gender?: string;
	birthdate?: string;
	zoneinfo?: string;
	locale?: string;
	phone_number?: string;
	phone_number_verified?: boolean;
	address?: any;
	updated_at?: number;
	[key: string]: any;
}

@Injectable()
export class OIDCClientService {
	private readonly logger: Logger;
	private readonly configCache = new Map<string, { config: OIDCConfiguration; expiresAt: number }>();
	private readonly jwksCache = new Map<string, { jwks: JWKSet; expiresAt: number }>();

	constructor(
		private readonly httpRequestService: HttpRequestService,
		private readonly loggerService: LoggerService,
		private readonly oauthClientService: OAuthClientService,
	) {
		this.logger = this.loggerService.getLogger('oidc-client');
	}

	/**
	 * Discover OIDC configuration from well-known endpoint
	 */
	@bindThis
	public async discoverConfiguration(issuer: string): Promise<OIDCConfiguration> {
		const wellKnownUrl = new URL('/.well-known/openid_configuration', issuer);

		try {
			const response = await this.httpRequestService.send(wellKnownUrl.toString(), {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch OIDC configuration: ${response.status}`);
			}

			const config = await response.json() as OIDCConfiguration;

			// Validate required fields
			if (!config.issuer || !config.authorization_endpoint || !config.token_endpoint || !config.jwks_uri) {
				throw new Error('Invalid OIDC configuration: missing required fields');
			}

			// Cache configuration
			this.configCache.set(issuer, {
				config,
				expiresAt: Date.now() + (1000 * 60 * 60), // 1 hour
			});

			return config;
		} catch (error) {
			this.logger.error('Error discovering OIDC configuration', { issuer, error });
			throw error;
		}
	}

	/**
	 * Get JWK Set from JWKS endpoint
	 */
	@bindThis
	public async getJWKSet(jwksUri: string): Promise<JWKSet> {
		try {
			const response = await this.httpRequestService.send(jwksUri, {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch JWK Set: ${response.status}`);
			}

			const jwks = await response.json() as JWKSet;

			// Cache JWK Set
			this.jwksCache.set(jwksUri, {
				jwks,
				expiresAt: Date.now() + (1000 * 60 * 60), // 1 hour
			});

			return jwks;
		} catch (error) {
			this.logger.error('Error fetching JWK Set', { jwksUri, error });
			throw error;
		}
	}

	/**
	 * Create OIDC client configuration from discovery
	 */
	@bindThis
	public async createClientConfig(
		issuer: string,
		clientId: string,
		clientSecret: string,
		redirectUri: string,
		scopes: string[] = ['openid', 'profile', 'email'],
	): Promise<OAuthClientConfig> {
		const oidcConfig = await this.discoverConfiguration(issuer);

		return {
			clientId,
			clientSecret,
			redirectUri,
			scope: scopes,
			authorizationEndpoint: oidcConfig.authorization_endpoint,
			tokenEndpoint: oidcConfig.token_endpoint,
			userInfoEndpoint: oidcConfig.userinfo_endpoint,
			issuer: oidcConfig.issuer,
			jwksUri: oidcConfig.jwks_uri,
			responseType: 'code',
			grantType: 'authorization_code',
			pkce: oidcConfig.code_challenge_methods_supported?.includes('S256') ?? false,
		};
	}

	/**
	 * Parse and validate ID Token (basic validation without signature verification)
	 */
	@bindThis
	public parseIDToken(idToken: string): IDTokenClaims {
		const parts = idToken.split('.');
		if (parts.length !== 3) {
			throw new Error('Invalid ID Token format');
		}

		try {
			const payload = parts[1];
			const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
			const decodedPayload = Buffer.from(paddedPayload, 'base64url').toString('utf8');
			const claims = JSON.parse(decodedPayload) as IDTokenClaims;

			// Basic validation
			if (!claims.iss || !claims.sub || !claims.aud || !claims.exp || !claims.iat) {
				throw new Error('Invalid ID Token: missing required claims');
			}

			// Check expiration
			if (claims.exp * 1000 < Date.now()) {
				throw new Error('ID Token has expired');
			}

			return claims;
		} catch (error) {
			this.logger.error('Error parsing ID Token', { error });
			throw new Error('Failed to parse ID Token');
		}
	}

	/**
	 * Validate ID Token claims
	 */
	@bindThis
	public validateIDTokenClaims(
		claims: IDTokenClaims,
		config: OAuthClientConfig,
		nonce?: string,
	): boolean {
		// Validate issuer
		if (config.issuer && claims.iss !== config.issuer) {
			this.logger.error('ID Token issuer validation failed', {
				expected: config.issuer,
				actual: claims.iss
			});
			return false;
		}

		// Validate audience
		const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!audiences.includes(config.clientId)) {
			this.logger.error('ID Token audience validation failed', {
				clientId: config.clientId,
				audiences
			});
			return false;
		}

		// Validate nonce if provided
		if (nonce && claims.nonce !== nonce) {
			this.logger.error('ID Token nonce validation failed', {
				expected: nonce,
				actual: claims.nonce
			});
			return false;
		}

		// Validate issued at time (not too far in the past or future)
		const now = Math.floor(Date.now() / 1000);
		const issuedAt = claims.iat;
		const maxAge = 60 * 60; // 1 hour

		if (issuedAt > now + 300) { // 5 minutes clock skew
			this.logger.error('ID Token issued in the future', { issuedAt, now });
			return false;
		}

		if (now - issuedAt > maxAge) {
			this.logger.error('ID Token too old', { issuedAt, now, age: now - issuedAt });
			return false;
		}

		return true;
	}

	/**
	 * Extract user information from ID Token
	 */
	@bindThis
	public extractUserInfoFromIDToken(claims: IDTokenClaims): UserInfo {
		return {
			sub: claims.sub,
			name: claims.name,
			given_name: claims.given_name,
			family_name: claims.family_name,
			email: claims.email,
			email_verified: claims.email_verified,
			picture: claims.picture,
			locale: claims.locale,
			preferred_username: claims.preferred_username,
			profile: claims.profile,
			website: claims.website,
		};
	}

	/**
	 * Complete OIDC authentication flow
	 */
	@bindThis
	public async authenticate(
		code: string,
		state: string,
	): Promise<{ tokenResponse: TokenResponse; userInfo: UserInfo; idTokenClaims?: IDTokenClaims }> {
		// Get cached state data to retrieve nonce and config
		const stateData = this.oauthClientService.getStateData(state);
		if (!stateData) {
			throw new Error('Invalid or expired state');
		}

		const { config, nonce } = stateData;

		// Exchange code for tokens
		const tokenResponse = await this.oauthClientService.exchangeCodeForToken(code, state);

		let idTokenClaims: IDTokenClaims | undefined;
		let userInfo: UserInfo;

		// If we have an ID token, parse and validate it
		if (tokenResponse.id_token) {
			idTokenClaims = this.parseIDToken(tokenResponse.id_token);

			if (!this.validateIDTokenClaims(idTokenClaims, config, nonce)) {
				throw new Error('ID Token validation failed');
			}

			// Extract user info from ID token
			userInfo = this.extractUserInfoFromIDToken(idTokenClaims);
		} else {
			// Fallback to UserInfo endpoint
			userInfo = await this.oauthClientService.getUserInfo(config, tokenResponse.access_token);
		}

		return {
			tokenResponse,
			userInfo,
			idTokenClaims,
		};
	}
}
