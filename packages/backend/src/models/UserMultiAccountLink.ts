/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column, Index, Unique } from 'typeorm';
import { id } from './util/id.js';

@Entity('user_multi_account_link')
@Unique(['userId', 'linkedUserId'])
export class MiUserMultiAccountLink {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('varchar', {
		length: 32,
	})
	public userId: string;

	@Index()
	@Column('varchar', {
		length: 32,
	})
	public linkedUserId: string;

	@Column('varchar', {
		length: 32,
	})
	public linkType: 'ip' | 'device' | 'behavior' | 'email_pattern' | 'mixed';

	@Column('real', {
		default: 0.5,
	})
	public confidence: number;

	@Column('jsonb', {
		default: {},
	})
	public evidence: {
		ips?: string[];
		userAgents?: string[];
		behaviors?: string[];
		timestamps?: string[];
		[key: string]: any;
	};

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public lastSeenAt: Date;
}
