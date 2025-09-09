/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { id } from './util/id.js';

@Entity('risk_event_log')
export class MiRiskEventLog {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('varchar', {
		length: 32,
	})
	public userId: string;

	@Index()
	@Column('varchar', {
		length: 64,
	})
	public eventType: string;

	@Column('real')
	public riskScore: number;

	@Index()
	@Column('varchar', {
		length: 32,
	})
	public riskLevel: string;

	@Column('jsonb', {
		default: {},
	})
	public details: Record<string, any>;

	@Column('varchar', {
		length: 128,
		nullable: true,
	})
	public ip: string | null;

	@Column('text', {
		nullable: true,
	})
	public userAgent: string | null;

	@Index()
	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;
}
