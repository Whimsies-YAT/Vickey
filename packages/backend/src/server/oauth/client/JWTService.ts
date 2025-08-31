/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { createHash, createVerify } from 'node:crypto';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { CacheService } from '@/core/CacheService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import type { JWKSet, JWK } from './OIDCClientService.js';

export interface JWTHeader {
	alg: string;
	typ?: string;
	kid?: string;
	x5t?: string;
	'x5t#S256'?: string;
}

export interface JWTPayload {
	iss?: string;
	sub?: string;
	aud?: string | string[];
	exp?: number;
	iat?: number;
	nbf?: number;
	jti?: string;
	[key: string]: any;
}

export interface DecodedJWT {
	header: JWTHeader;
	payload: JWTPayload;
	signature: string;
	raw: {
		header: string;
		payload: string;
		signature: string;
	};
}

@Injectable()
export class JWTService {
	private readonly logger: Logger;
	private readonly jwksCache = new Map<string, { jwks: JWKSet; expiresAt: number }>();

	constructor(
		private readonly httpRequestService: HttpRequestService,
		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('jwt');
	}

	/**
	 * Decode JWT without verification
	 */
	@bindThis
	public decode(token: string): DecodedJWT {
		const parts = token.split('.');
		if (parts.length !== 3) {
			throw new Error('Invalid JWT format');
		}

		try {
			const header = this.decodeBase64Url(parts[0]);
			const payload = this.decodeBase64Url(parts[1]);

			return {
				header: JSON.parse(header) as JWTHeader,
				payload: JSON.parse(payload) as JWTPayload,
				signature: parts[2],
				raw: {
					header: parts[0],
					payload: parts[1],
					signature: parts[2],
				},
			};
		} catch (error) {
			this.logger.error('Failed to decode JWT', { error });
			throw new Error('Invalid JWT format');
		}
	}

	/**
	 * Verify JWT signature using JWK Set
	 */
	@bindThis
	public async verify(
		token: string,
		jwksUri: string,
		options: {
			issuer?: string;
			audience?: string | string[];
			clockTolerance?: number; // seconds
		} = {},
	): Promise<JWTPayload> {
		const decoded = this.decode(token);

		// Get JWK Set
		const jwks = await this.getJWKSet(jwksUri);

		// Find matching key
		const jwk = this.findMatchingKey(jwks, decoded.header);
		if (!jwk) {
			throw new Error('No matching key found in JWK Set');
		}

		// Verify signature
		const isValid = await this.verifySignature(token, jwk);
		if (!isValid) {
			throw new Error('JWT signature verification failed');
		}

		// Verify claims
		this.verifyClaims(decoded.payload, options);

		return decoded.payload;
	}

	/**
	 * Verify JWT claims
	 */
	@bindThis
	private verifyClaims(
		payload: JWTPayload,
		options: {
			issuer?: string;
			audience?: string | string[];
			clockTolerance?: number;
		},
	): void {
		const now = Math.floor(Date.now() / 1000);
		const clockTolerance = options.clockTolerance || 300; // 5 minutes default

		// Verify expiration
		if (payload.exp && payload.exp < (now - clockTolerance)) {
			throw new Error('JWT has expired');
		}

		// Verify not before
		if (payload.nbf && payload.nbf > (now + clockTolerance)) {
			throw new Error('JWT not yet valid');
		}

		// Verify issued at
		if (payload.iat && payload.iat > (now + clockTolerance)) {
			throw new Error('JWT issued in the future');
		}

		// Verify issuer
		if (options.issuer && payload.iss !== options.issuer) {
			throw new Error(`Invalid issuer: expected ${options.issuer}, got ${payload.iss}`);
		}

		// Verify audience
		if (options.audience) {
			const expectedAudiences = Array.isArray(options.audience) ? options.audience : [options.audience];
			const actualAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

			const hasValidAudience = expectedAudiences.some(expected =>
				actualAudiences.includes(expected),
			);

			if (!hasValidAudience) {
				throw new Error(`Invalid audience: expected ${expectedAudiences.join(', ')}, got ${actualAudiences.join(', ')}`);
			}
		}
	}

	/**
	 * Get JWK Set with caching
	 */
	@bindThis
	private async getJWKSet(jwksUri: string): Promise<JWKSet> {
		const now = Date.now();

		// Try cache first
		const cached = this.jwksCache.get(jwksUri);
		if (cached && cached.expiresAt > now) {
			return cached.jwks;
		}

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

			// Cache for 1 hour
			this.jwksCache.set(jwksUri, {
				jwks,
				expiresAt: now + (1000 * 60 * 60), // 1 hour
			});

			return jwks;
		} catch (error) {
			this.logger.error('Failed to fetch JWK Set', { jwksUri, error });
			throw error;
		}
	}

	/**
	 * Find matching JWK for JWT header
	 */
	@bindThis
	private findMatchingKey(jwks: JWKSet, header: JWTHeader): JWK | null {
		for (const key of jwks.keys) {
			// Match by key ID
			if (header.kid && key.kid === header.kid) {
				return key;
			}

			// Match by x5t thumbprint
			if (header.x5t && key.x5t === header.x5t) {
				return key;
			}

			// Match by x5t#S256 thumbprint
			if (header['x5t#S256'] && key['x5t#S256'] === header['x5t#S256']) {
				return key;
			}

			// Match by algorithm and key type
			if (key.alg === header.alg && this.isKeyCompatible(key, header.alg)) {
				return key;
			}
		}

		// If no specific match, return first compatible key
		for (const key of jwks.keys) {
			if (this.isKeyCompatible(key, header.alg)) {
				return key;
			}
		}

		return null;
	}

	/**
	 * Check if JWK is compatible with algorithm
	 */
	@bindThis
	private isKeyCompatible(jwk: JWK, algorithm: string): boolean {
		switch (algorithm) {
			case 'RS256':
			case 'RS384':
			case 'RS512':
				return jwk.kty === 'RSA';
			case 'ES256':
			case 'ES384':
			case 'ES512':
				return jwk.kty === 'EC';
			case 'HS256':
			case 'HS384':
			case 'HS512':
				return jwk.kty === 'oct';
			default:
				return false;
		}
	}

	/**
	 * Verify JWT signature
	 */
	@bindThis
	private async verifySignature(token: string, jwk: JWK): Promise<boolean> {
		const parts = token.split('.');
		const message = `${parts[0]}.${parts[1]}`;
		const signature = Buffer.from(parts[2], 'base64url');

		try {
			switch (jwk.kty) {
				case 'RSA':
					return this.verifyRSASignature(message, signature, jwk);
				case 'EC':
					return this.verifyECSignature(message, signature, jwk);
				case 'oct':
					return this.verifyHMACSignature(message, signature, jwk);
				default:
					throw new Error(`Unsupported key type: ${jwk.kty}`);
			}
		} catch (error) {
			this.logger.error('Signature verification failed', { error });
			return false;
		}
	}

	/**
	 * Verify RSA signature
	 */
	@bindThis
	private verifyRSASignature(message: string, signature: Buffer, jwk: JWK): boolean {
		if (!jwk.n || !jwk.e) {
			throw new Error('Invalid RSA key: missing n or e');
		}

		// Convert JWK to PEM format
		const n = Buffer.from(jwk.n, 'base64url');
		const e = Buffer.from(jwk.e, 'base64url');
		const publicKey = this.rsaPublicKeyFromComponents(n, e);

		const verifier = createVerify('sha256');
		verifier.update(message);

		return verifier.verify(publicKey, signature);
	}

	/**
	 * Verify ECDSA signature
	 */
	@bindThis
	private verifyECSignature(message: string, signature: Buffer, jwk: JWK): boolean {
		if (!jwk.x || !jwk.y || !jwk.crv) {
			throw new Error('Invalid EC key: missing x, y, or crv');
		}

		// This is a simplified implementation
		// In production, you would need proper ECDSA verification
		throw new Error('ECDSA signature verification not implemented');
	}

	/**
	 * Verify HMAC signature
	 */
	@bindThis
	private verifyHMACSignature(message: string, signature: Buffer, jwk: JWK): boolean {
		if (!jwk.k) {
			throw new Error('Invalid symmetric key: missing k');
		}

		const key = Buffer.from(jwk.k, 'base64url');
		const expectedSignature = createHash('sha256')
			.update(message + key.toString('base64'))
			.digest();

		return signature.equals(expectedSignature);
	}

	/**
	 * Convert RSA components to PEM public key
	 */
	@bindThis
	private rsaPublicKeyFromComponents(n: Buffer, e: Buffer): string {
		// This is a simplified implementation
		// In production, you would need proper ASN.1 encoding
		const keyData = Buffer.concat([n, e]).toString('base64');
		return `-----BEGIN PUBLIC KEY-----\n${keyData}\n-----END PUBLIC KEY-----`;
	}

	/**
	 * Base64URL decode
	 */
	@bindThis
	private decodeBase64Url(str: string): string {
		// Add padding if needed
		const padded = str + '='.repeat((4 - str.length % 4) % 4);
		return Buffer.from(padded, 'base64url').toString('utf8');
	}

	/**
	 * Base64URL encode
	 */
	@bindThis
	private encodeBase64Url(str: string): string {
		return Buffer.from(str, 'utf8')
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
	}

	/**
	 * Create JWT (for testing purposes)
	 */
	@bindThis
	public createJWT(
		payload: JWTPayload,
		secret: string,
		algorithm: string = 'HS256',
	): string {
		const header: JWTHeader = {
			alg: algorithm,
			typ: 'JWT',
		};

		const encodedHeader = this.encodeBase64Url(JSON.stringify(header));
		const encodedPayload = this.encodeBase64Url(JSON.stringify(payload));
		const message = `${encodedHeader}.${encodedPayload}`;

		let signature: string;
		switch (algorithm) {
			case 'HS256':
				signature = createHash('sha256')
					.update(message + secret)
					.digest('base64url');
				break;
			default:
				throw new Error(`Unsupported algorithm: ${algorithm}`);
		}

		return `${message}.${signature}`;
	}
}
