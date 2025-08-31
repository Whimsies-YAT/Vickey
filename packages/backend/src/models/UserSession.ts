/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('user_session')
export class MiUserSession {
	@PrimaryColumn(id())
	public id: string;

	@Column('varchar', {
		length: 128,
		comment: 'The user ID who owns this session.',
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
		comment: 'The OAuth provider ID.',
	})
	@Index()
	public providerId: string;

	@Column('varchar', {
		length: 128,
		comment: 'The OAuth provider name.',
	})
	public providerName: string;

	@Column('jsonb', {
		comment: 'The user information from OAuth provider.',
	})
	public userInfo: {
		sub: string;
		name?: string;
		given_name?: string;
		family_name?: string;
		email?: string;
		email_verified?: boolean;
		picture?: string;
		locale?: string;
		preferred_username?: string;
		profile?: string;
		website?: string;
		[key: string]: any;
	};

	@Column('jsonb', {
		nullable: true,
		comment: 'The ID token claims from OIDC provider.',
	})
	public idTokenClaims: {
		iss: string;
		sub: string;
		aud: string | string[];
		exp: number;
		iat: number;
		auth_time?: number;
		nonce?: string;
		at_hash?: string;
		c_hash?: string;
		[key: string]: any;
	} | null;

	@Column('varchar', {
		length: 1024,
		nullable: true,
		comment: 'The OAuth access token.',
	})
	public accessToken: string | null;

	@Column('varchar', {
		length: 1024,
		nullable: true,
		comment: 'The OAuth refresh token.',
	})
	public refreshToken: string | null;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'The token expiration date.',
	})
	public tokenExpiresAt: Date | null;

	@Column('varchar', {
		length: 256,
		nullable: true,
		comment: 'The IP address of the client.',
	})
	public ipAddress: string | null;

	@Column('varchar', {
		length: 500,
		nullable: true,
		comment: 'The user agent of the client.',
	})
	public userAgent: string | null;

	@Column('timestamp with time zone', {
		comment: 'The created date of the session.',
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		comment: 'The last used date of the session.',
		default: () => 'CURRENT_TIMESTAMP',
	})
	public lastUsedAt: Date;
}
