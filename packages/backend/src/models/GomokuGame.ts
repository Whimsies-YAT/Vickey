/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('gomoku_game')
export class MiGomokuGame {
	@PrimaryColumn(id())
	public id: string;

	@CreateDateColumn()
	public createdAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'The started date of the GomokuGame.',
	})
	public startedAt: Date | null;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'The ended date of the GomokuGame.',
	})
	public endedAt: Date | null;

	@Index()
	@Column(id())
	public user1Id: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user1: MiUser | null;

	@Index()
	@Column(id())
	public user2Id: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user2: MiUser | null;

	@Column('boolean', {
		default: false,
	})
	public user1Ready: boolean;

	@Column('boolean', {
		default: false,
	})
	public user2Ready: boolean;

	@Column('integer', {
		nullable: true,
	})
	public black: number | null;

	@Column('boolean', {
		default: false,
	})
	public isStarted: boolean;

	@Column('boolean', {
		default: false,
	})
	public isEnded: boolean;

	@Column({
		...id(),
		nullable: true,
	})
	public winnerId: MiUser['id'] | null;

	@Column({
		...id(),
		nullable: true,
	})
	public surrenderedUserId: MiUser['id'] | null;

	@Column('jsonb', {
		default: [],
	})
	public board: number[];

	@Column('jsonb', {
		default: [],
	})
	public logs: number[][];
}
