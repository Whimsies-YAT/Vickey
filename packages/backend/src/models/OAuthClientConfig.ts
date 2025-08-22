/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('oauth_client_config')
export class MiOAuthClientConfig {
	@PrimaryColumn(id())
	public id: string;

	@Column('varchar', {
		length: 128,
		comment: 'The user ID who created this configuration.',
	})
	@Index()
	public userId: string;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 128,
		comment: 'The display name of the OAuth provider.',
	})
	public name: string;

	@Column('enum', {
		enum: ['oauth2', 'oidc'],
		default: 'oauth2',
		comment: 'The type of OAuth provider.',
	})
	public type: 'oauth2' | 'oidc';

	@Column('varchar', {
		length: 256,
		comment: 'The OAuth client ID.',
	})
	public clientId: string;

	@Column('varchar', {
		length: 512,
		comment: 'The OAuth client secret.',
	})
	public clientSecret: string;

	@Column('varchar', {
		length: 512,
		comment: 'The OAuth authorization endpoint URL.',
	})
	public authorizationEndpoint: string;

	@Column('varchar', {
		length: 512,
		comment: 'The OAuth token endpoint URL.',
	})
	public tokenEndpoint: string;

	@Column('varchar', {
		length: 512,
		nullable: true,
		comment: 'The OAuth user info endpoint URL.',
	})
	public userInfoEndpoint: string | null;

	@Column('varchar', {
		length: 512,
		nullable: true,
		comment: 'The OIDC issuer URL.',
	})
	public issuer: string | null;

	@Column('varchar', {
		length: 512,
		nullable: true,
		comment: 'The OIDC JWK Set endpoint URL.',
	})
	public jwksUri: string | null;

	@Column('simple-array', {
		default: [],
		comment: 'The OAuth scopes to request.',
	})
	public scope: string[];

	@Column('varchar', {
		length: 512,
		comment: 'The OAuth redirect URI.',
	})
	public redirectUri: string;

	@Column('boolean', {
		default: false,
		comment: 'Whether to automatically register new users.',
	})
	public autoRegister: boolean;

	@Column('boolean', {
		default: true,
		comment: 'Whether to automatically update user information.',
	})
	public autoUpdate: boolean;

	@Column('jsonb', {
		default: {},
		comment: 'User field mapping configuration.',
	})
	public userMapping: {
		username?: string;
		email?: string;
		name?: string;
		avatar?: string;
	};

	@Column('boolean', {
		default: true,
		comment: 'Whether this configuration is active.',
	})
	public isActive: boolean;

	@Column('timestamp with time zone', {
		comment: 'The created date of the configuration.',
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		comment: 'The updated date of the configuration.',
		default: () => 'CURRENT_TIMESTAMP',
	})
	public updatedAt: Date;
}