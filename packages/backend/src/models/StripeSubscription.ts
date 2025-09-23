/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('stripe_subscription')
@Index(['userId'])
@Index(['stripeSubscriptionId'], { unique: true })
export class MiStripeSubscription {
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
	public stripeSubscriptionId: string;

	@Column('varchar', {
		length: 256,
	})
	public stripeCustomerId: string;

	@Column('varchar', {
		length: 256,
	})
	public stripePriceId: string;

	@Column('varchar', {
		length: 256,
		nullable: true,
	})
	public stripeProductId: string | null;

	@Column('enum', {
		enum: [
			'incomplete',
			'incomplete_expired',
			'trialing',
			'active',
			'past_due',
			'canceled',
			'unpaid',
			'paused',
		],
	})
	public status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';

	@Column('timestamptz')
	public currentPeriodStart: Date;

	@Column('timestamptz')
	public currentPeriodEnd: Date;

	@Column('boolean', {
		default: false,
	})
	public cancelAtPeriodEnd: boolean;

	@Column('timestamptz', {
		nullable: true,
	})
	public canceledAt: Date | null;

	@Column('timestamptz', {
		nullable: true,
	})
	public endedAt: Date | null;

	@Column('timestamptz', {
		nullable: true,
	})
	public trialStart: Date | null;

	@Column('timestamptz', {
		nullable: true,
	})
	public trialEnd: Date | null;

	@Column('varchar', {
		length: 512,
		nullable: true,
	})
	public subscriptionReason: string | null;

	@Column('text', {
		nullable: true,
	})
	public adminNotes: string | null;

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
