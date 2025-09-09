/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { id } from './util/id.js';

@Entity('user_risk_score_history')
export class MiUserRiskScoreHistory {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('varchar', {
		length: 32,
	})
	public userId: string;

	@Column('real', {
		default: 50,
	})
	public totalScore: number;

	@Index()
	@Column('varchar', {
		length: 32,
		default: 'medium',
	})
	public riskLevel: string;

	@Column('real', {
		default: 0,
	})
	public profileScore: number;

	@Column('real', {
		default: 0,
	})
	public activityScore: number;

	@Column('real', {
		default: 0,
	})
	public relationshipScore: number;

	@Column('real', {
		default: 0,
	})
	public contentScore: number;

	@Column('real', {
		default: 0,
	})
	public engagementScore: number;

	@Column('real', {
		default: 0,
	})
	public multiAccountScore: number;

	@Index()
	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public calculatedAt: Date;
}
