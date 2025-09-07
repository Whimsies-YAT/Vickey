/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';

@Entity('user_interaction_history')
export class MiUserInteractionHistory {
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
	public targetId: string;

	@Column('varchar', {
		length: 32,
		comment: 'Type of target (note, user, hashtag, etc.)',
	})
	public targetType: 'note' | 'user' | 'hashtag' | 'category';

	@Column('varchar', {
		length: 32,
		comment: 'Type of interaction',
	})
	public interactionType: 'view' | 'like' | 'reply' | 'renote' | 'follow' | 'bookmark' | 'share' | 'click';

	@Column('real', {
		default: 1.0,
		comment: 'Interaction weight/intensity',
	})
	public weight: number;

	@Column('integer', {
		nullable: true,
		comment: 'Duration of interaction in seconds',
	})
	public duration: number | null;

	@Column('jsonb', {
		default: '{}',
		comment: 'Additional context data',
	})
	public context: {
		source?: string;
		position?: number;
		deviceType?: string;
		timeOfDay?: number;
		sentiment?: number;
	};

	@Index()
	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('boolean', {
		default: false,
		comment: 'Whether this interaction was implicit (view) or explicit (like)',
	})
	public implicit: boolean;

	@Column('real', {
		nullable: true,
		comment: 'Calculated relevance score for this interaction',
	})
	public relevanceScore: number | null;
}
