/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, Column } from 'typeorm';
import { id } from './util/id.js';

@Entity('abuse_note_autocheck')
@Index(['id'], { unique: true })
export class MiAbuseNoteAutoCheck {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('varchar', {
		nullable: false,
		default: '{}',
	})
	public detail: object;

	@Column('numeric', {
		nullable: false,
		scale: 2,
	})
	public score: number;

	@Column('boolean', {
		nullable: false,
		default: false,
	})
	public ignore: boolean;
}
