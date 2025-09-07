/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('user_interest_embedding')
export class MiUserInterestEmbedding {
	@PrimaryColumn(id())
	public id: string;

	@Index('IDX_user_interest_embedding_user_model', { unique: true })
	@Column(id())
	public userId: string;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('real', { array: true })
	public embedding: number[];

	@Index('IDX_user_interest_embedding_user_model', { unique: true })
	@Column('varchar', {
		length: 32,
		default: 'distiluse-v1',
	})
	public modelVersion: string;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public lastUpdate: Date;

	@Column('int', {
		default: 0,
	})
	public interactionCount: number;
}
