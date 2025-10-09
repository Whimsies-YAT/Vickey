/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('stripe_payment')
@Index(['userId'])
@Index(['stripePaymentIntentId'], { unique: true, sparse: true })
@Index(['stripeCheckoutSessionId'], { unique: true, sparse: true })
export class MiStripePayment {
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
		nullable: true,
	})
	public stripePaymentIntentId: string | null;

	@Column('varchar', {
		length: 256,
		nullable: true,
	})
	public stripeCheckoutSessionId: string | null;

	@Column('varchar', {
		length: 256,
		nullable: true,
	})
	public stripeCustomerId: string | null;

	@Column('integer')
	public amount: number;

	@Column('varchar', {
		length: 3,
	})
	public currency: string;

	@Column('enum', {
		enum: [
			'requires_payment_method',
			'requires_confirmation',
			'requires_action',
			'processing',
			'requires_capture',
			'canceled',
			'succeeded',
		],
	})
	public status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';

	@Column('varchar', {
		length: 512,
		nullable: true,
	})
	public description: string | null;

	@Column('varchar', {
		length: 512,
		nullable: true,
	})
	public paymentReason: string | null;

	@Column('boolean', {
		default: false,
	})
	public isRefunded: boolean;

	@Column('integer', {
		default: 0,
	})
	public refundedAmount: number;

	@Column('varchar', {
		length: 50,
		nullable: true,
	})
	public stripeRiskLevel: string | null;

	@Column('integer', {
		nullable: true,
	})
	public stripeRiskScore: number | null;

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
