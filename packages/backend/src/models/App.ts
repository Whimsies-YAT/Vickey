/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('app')
export class MiApp {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
		nullable: true,
		comment: 'The owner ID.',
	})
	public userId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'SET NULL',
		nullable: true,
	})
	public user: MiUser | null;

	@Index()
	@Column('varchar', {
		length: 64,
		comment: 'The secret key of the App.',
	})
	public secret: string;

	@Column('varchar', {
		length: 128,
		comment: 'The name of the App.',
	})
	public name: string;

	@Column('varchar', {
		length: 512,
		comment: 'The description of the App.',
	})
	public description: string;

	@Column('varchar', {
		length: 64, array: true,
		comment: 'The permission of the App.',
	})
	public permission: string[];

	@Column('varchar', {
		length: 512, nullable: true,
		comment: 'The callbackUrl of the App.',
	})
	public callbackUrl: string | null;

	@Column('boolean', {
		default: false,
		comment: 'Whether this is an OAuth app (uses URL client_id).',
	})
	public isOAuth: boolean;

	@Column('varchar', {
		length: 512, nullable: true,
		comment: 'The icon URL of the OAuth App.',
	})
	public iconUrl: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
		comment: 'The website URL of the OAuth App.',
	})
	public websiteUrl: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
		comment: 'The OAuth client_id URL for IndieAuth compatibility.',
	})
	public clientId: string | null;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
		comment: 'The created date of the App.',
	})
	public createdAt: Date;
}
