/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('stripe_customer')
@Index(['userId'], { unique: true })
export class MiStripeCustomer {
	@PrimaryColumn(id())
	public id: string;

	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	public user: MiUser | null;

	@Column('varchar', {
		length: 256,
	})
	public stripeCustomerId: string;

	@Column('varchar', {
		length: 256,
		nullable: true,
	})
	public email: string | null;

	@Column('varchar', {
		length: 256,
		nullable: true,
	})
	public name: string | null;

	@Column('jsonb', {
		default: {},
	})
	public metadata: Record<string, any>;

	@Column('timestamptz', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamptz', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public updatedAt: Date;
}