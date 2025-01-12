/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, Column } from 'typeorm';

@Entity('email_templates')
@Index(['key', 'content'], { unique: true })
export class MiEmailTemplates {
	@PrimaryColumn('varchar', {
		length: 1024,
	})
	public key: string;

	@Index()
	@Column('varchar', {
		nullable: false,
		array: true,
		default: '{}',
	})
	public content: string[];

	@Column('boolean', {
		default: false,
	})
	public enabled: boolean;
}
