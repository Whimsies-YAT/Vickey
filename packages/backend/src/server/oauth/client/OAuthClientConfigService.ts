/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import type { OAuthClientConfigsRepository } from '@/models/_.js';
import type { MiOAuthClientConfig } from '@/models/OAuthClientConfig.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { OIDCClientService } from './OIDCClientService.js';
import type { OAuthClientConfig } from './OAuthClientService.js';
import type { SSOProvider } from './SSOService.js';

export interface CreateOAuthClientConfigRequest {
	name: string;
	type: 'oauth2' | 'oidc';
	clientId: string;
	clientSecret: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userInfoEndpoint?: string | null;
	issuer?: string | null;
	jwksUri?: string | null;
	scope?: string[];
	redirectUri: string;
	autoRegister?: boolean;
	autoUpdate?: boolean;
	userMapping?: {
		username?: string | null;
		email?: string | null;
		name?: string | null;
		avatar?: string | null;
	};
}

export interface UpdateOAuthClientConfigRequest extends Partial<CreateOAuthClientConfigRequest> {
	id: string;
}

@Injectable()
export class OAuthClientConfigService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.oauthClientConfigsRepository)
		private readonly oauthClientConfigsRepository: OAuthClientConfigsRepository,

		private readonly loggerService: LoggerService,
		private readonly idService: IdService,
		private readonly oidcClientService: OIDCClientService,
	) {
		this.logger = this.loggerService.getLogger('oauth-client-config');
	}

	/**
	 * Create OAuth client configuration
	 */
	@bindThis
	public async create(request: CreateOAuthClientConfigRequest, userId: string): Promise<MiOAuthClientConfig> {
		const id = this.idService.gen();

		const config = await this.oauthClientConfigsRepository.insert({
			id,
			userId,
			name: request.name,
			type: request.type,
			clientId: request.clientId,
			clientSecret: request.clientSecret,
			authorizationEndpoint: request.authorizationEndpoint,
			tokenEndpoint: request.tokenEndpoint,
			userInfoEndpoint: request.userInfoEndpoint,
			issuer: request.issuer,
			jwksUri: request.jwksUri,
			scope: request.scope ?? [],
			redirectUri: request.redirectUri,
			autoRegister: request.autoRegister ?? false,
			autoUpdate: request.autoUpdate ?? true,
			userMapping: request.userMapping ? {
				username: request.userMapping.username ?? undefined,
				email: request.userMapping.email ?? undefined,
				name: request.userMapping.name ?? undefined,
				avatar: request.userMapping.avatar ?? undefined,
			} : undefined,
			isActive: true,
		}).then(result => result.generatedMaps[0] as MiOAuthClientConfig);

		this.logger.info(`Created OAuth client config: ${request.name} (${request.type})`);

		return config;
	}

	/**
	 * Update OAuth client configuration
	 */
	@bindThis
	public async update(request: UpdateOAuthClientConfigRequest, userId: string): Promise<MiOAuthClientConfig> {
		const config = await this.oauthClientConfigsRepository.findOne({
			where: { id: request.id, userId },
		});

		if (!config) {
			throw new Error('OAuth client configuration not found');
		}

		const updates: Record<string, unknown> = {};

		if (request.name !== undefined) updates.name = request.name;
		if (request.type !== undefined) updates.type = request.type;
		if (request.clientId !== undefined) updates.clientId = request.clientId;
		if (request.clientSecret !== undefined) updates.clientSecret = request.clientSecret;
		if (request.authorizationEndpoint !== undefined) updates.authorizationEndpoint = request.authorizationEndpoint;
		if (request.tokenEndpoint !== undefined) updates.tokenEndpoint = request.tokenEndpoint;
		if (request.userInfoEndpoint !== undefined) updates.userInfoEndpoint = request.userInfoEndpoint;
		if (request.issuer !== undefined) updates.issuer = request.issuer;
		if (request.jwksUri !== undefined) updates.jwksUri = request.jwksUri;
		if (request.scope !== undefined) updates.scope = request.scope;
		if (request.redirectUri !== undefined) updates.redirectUri = request.redirectUri;
		if (request.autoRegister !== undefined) updates.autoRegister = request.autoRegister;
		if (request.autoUpdate !== undefined) updates.autoUpdate = request.autoUpdate;
		if (request.userMapping !== undefined) updates.userMapping = request.userMapping;

		await this.oauthClientConfigsRepository.update(config.id, updates);

		const updatedConfig = await this.oauthClientConfigsRepository.findOneByOrFail({ id: config.id });

		this.logger.info(`Updated OAuth client config: ${updatedConfig.name}`);

		return updatedConfig;
	}

	/**
	 * Delete OAuth client configuration
	 */
	@bindThis
	public async delete(id: string, userId: string): Promise<MiOAuthClientConfig> {
		const config = await this.oauthClientConfigsRepository.findOne({
			where: { id, userId },
		});

		if (!config) {
			throw new Error('OAuth client configuration not found');
		}

		await this.oauthClientConfigsRepository.delete(id);

		this.logger.info(`Deleted OAuth client config: ${config.name}`);

		return config;
	}

	/**
	 * Get OAuth client configuration by ID
	 */
	@bindThis
	public async get(id: string, userId: string): Promise<MiOAuthClientConfig | null> {
		return await this.oauthClientConfigsRepository.findOne({
			where: { id, userId },
		});
	}

	/**
	 * List all OAuth client configurations for user
	 */
	@bindThis
	public async list(userId: string): Promise<MiOAuthClientConfig[]> {
		return await this.oauthClientConfigsRepository.find({
			where: { userId },
			order: { createdAt: 'DESC' },
		});
	}

	/**
	 * List all active OAuth client configurations for user
	 */
	@bindThis
	public async listActive(userId: string): Promise<MiOAuthClientConfig[]> {
		return await this.oauthClientConfigsRepository.find({
			where: { userId, isActive: true },
			order: { createdAt: 'DESC' },
		});
	}

	/**
	 * Toggle OAuth client configuration active status
	 */
	@bindThis
	public async toggleActive(id: string, userId: string): Promise<MiOAuthClientConfig> {
		const config = await this.oauthClientConfigsRepository.findOne({
			where: { id, userId },
		});

		if (!config) {
			throw new Error('OAuth client configuration not found');
		}

		await this.oauthClientConfigsRepository.update(id, {
			isActive: !config.isActive,
		});

		const updatedConfig = await this.oauthClientConfigsRepository.findOneByOrFail({ id });

		this.logger.info(`Toggled OAuth client config active status: ${updatedConfig.name} -> ${updatedConfig.isActive}`);

		return updatedConfig;
	}

	/**
	 * Convert database config to OAuth client config
	 */
	@bindThis
	public toOAuthClientConfig(dbConfig: MiOAuthClientConfig): OAuthClientConfig {
		return {
			clientId: dbConfig.clientId,
			clientSecret: dbConfig.clientSecret,
			redirectUri: dbConfig.redirectUri,
			scope: dbConfig.scope,
			authorizationEndpoint: dbConfig.authorizationEndpoint,
			tokenEndpoint: dbConfig.tokenEndpoint,
			userInfoEndpoint: dbConfig.userInfoEndpoint ?? undefined,
			issuer: dbConfig.issuer ?? undefined,
			jwksUri: dbConfig.jwksUri ?? undefined,
			responseType: 'code',
			grantType: 'authorization_code',
			pkce: true,
		};
	}

	/**
	 * Convert database config to SSO provider
	 */
	@bindThis
	public toSSOProvider(dbConfig: MiOAuthClientConfig): SSOProvider {
		return {
			id: dbConfig.id,
			name: dbConfig.name,
			type: dbConfig.type as 'oauth2' | 'oidc',
			config: this.toOAuthClientConfig(dbConfig),
			autoRegister: dbConfig.autoRegister,
			autoUpdate: dbConfig.autoUpdate,
			userMapping: dbConfig.userMapping,
		};
	}

	/**
	 * Test OAuth client configuration
	 */
	@bindThis
	public async test(id: string, userId: string): Promise<{ success: boolean; error?: string }> {
		try {
			const config = await this.get(id, userId);
			if (!config) {
				return { success: false, error: 'Configuration not found' };
			}

			if (!config.clientId || !config.clientSecret) {
				return { success: false, error: 'Missing client credentials' };
			}

			if (!config.authorizationEndpoint || !config.tokenEndpoint) {
				return { success: false, error: 'Missing required endpoints' };
			}

			// TODO: Add more sophisticated testing like endpoint reachability

			return { success: true };
		} catch (error) {
			this.logger.error('Failed to test OAuth client configuration', { id, error });
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	/**
	 * Import configuration from well-known OIDC endpoint
	 */
	@bindThis
	public async importFromIssuer(
		issuer: string,
		name: string,
		clientId: string,
		clientSecret: string,
		redirectUri: string,
		userId: string,
	): Promise<MiOAuthClientConfig> {
		try {
			const config = await this.oidcClientService.discoverConfiguration(issuer);

			const request: CreateOAuthClientConfigRequest = {
				name,
				type: 'oidc',
				clientId,
				clientSecret,
				authorizationEndpoint: config.authorization_endpoint,
				tokenEndpoint: config.token_endpoint,
				userInfoEndpoint: config.userinfo_endpoint,
				issuer: config.issuer,
				jwksUri: config.jwks_uri,
				scope: ['openid', 'profile', 'email'],
				redirectUri,
				autoRegister: false,
				autoUpdate: true,
			};

			return await this.create(request, userId);
		} catch (error) {
			this.logger.error('Failed to import OIDC configuration', { issuer, error });
			throw error;
		}
	}
}
