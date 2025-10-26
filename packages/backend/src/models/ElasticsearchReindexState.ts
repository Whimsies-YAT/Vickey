/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Column, CreateDateColumn } from 'typeorm';

export type ReindexStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

@Entity('elasticsearch_reindex_state')
export class MiElasticsearchReindexState {
	@PrimaryColumn('varchar', { length: 512 })
	public indexPattern: string;

	@Column('varchar', { length: 32 })
	public status: ReindexStatus;

	@Column('varchar', { length: 512, nullable: true })
	public oldIndex: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public newIndex: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public taskId: string | null;

	@Column('jsonb')
	public targetConfig: any;

	@Column('integer', { default: 0 })
	public retryCount: number;

	@Column('text', { nullable: true })
	public errorMessage: string | null;

	@CreateDateColumn()
	public createdAt: Date;

	@Column('timestamp with time zone', { nullable: true })
	public startedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public completedAt: Date | null;

	@Column('varchar', { length: 128, nullable: true })
	public lockedBy: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public lockedAt: Date | null;
}
