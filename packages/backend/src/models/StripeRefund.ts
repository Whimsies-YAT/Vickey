/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiStripePayment } from './StripePayment.js';

@Entity('stripe_refund')
@Index(['userId'])
@Index(['stripeRefundId'], { unique: true })
@Index(['stripePaymentId'])
export class MiStripeRefund {
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
	public stripeRefundId: string;

	@Column({
		...id(),
	})
	public stripePaymentId: MiStripePayment['id'];

	@ManyToOne(type => MiStripePayment, {
		onDelete: 'CASCADE',
	})
	public stripePayment: MiStripePayment | null;

	@Column('varchar', {
		length: 256,
	})
	public stripeChargeId: string;

	@Column('integer')
	public amount: number;

	@Column('varchar', {
		length: 3,
	})
	public currency: string;

	@Column('enum', {
		enum: [
			'pending',
			'succeeded',
			'failed',
			'canceled',
		],
	})
	public status: 'pending' | 'succeeded' | 'failed' | 'canceled';

	@Column('varchar', {
		length: 50,
		nullable: true,
	})
	public reason: string | null;

	@Column('varchar', {
		length: 512,
		nullable: true,
	})
	public description: string | null;

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
