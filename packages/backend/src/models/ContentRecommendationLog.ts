/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';

@Entity('content_recommendation_log')
export class MiContentRecommendationLog {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column(id())
	public noteId: MiNote['id'];

	@ManyToOne(type => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public note: MiNote | null;

	@Column('varchar', {
		length: 64,
		comment: 'Recommendation algorithm used',
	})
	public algorithm: string;

	@Column('real', {
		comment: 'Recommendation score (0-1)',
	})
	public score: number;

	@Column('integer', {
		comment: 'Position in recommendation list',
	})
	public position: number;

	@Column('varchar', {
		length: 32,
		comment: 'Recommendation context (timeline, explore, etc.)',
	})
	public context: string;

	@Column('jsonb', {
		default: '{}',
		comment: 'Recommendation factors and weights',
	})
	public factors: Record<string, number>;

	@Column('boolean', {
		default: false,
		comment: 'Whether user viewed the content',
	})
	public viewed: boolean;

	@Column('boolean', {
		default: false,
		comment: 'Whether user engaged with the content',
	})
	public engaged: boolean;

	@Column('varchar', {
		length: 32,
		nullable: true,
		comment: 'Type of engagement (like, reply, renote, etc.)',
	})
	public engagementType: string | null;

	@Column('integer', {
		nullable: true,
		comment: 'Time spent viewing in seconds',
	})
	public viewDuration: number | null;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'When user first viewed the content',
	})
	public viewedAt: Date | null;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'When user engaged with the content',
	})
	public engagedAt: Date | null;
}
