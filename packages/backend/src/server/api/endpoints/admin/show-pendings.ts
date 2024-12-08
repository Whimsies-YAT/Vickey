/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserPendingsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { SchemaType } from "@/misc/json-schema.js";

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:show-pending',

	res: {
		type: 'array',
		nullable: false, optional: false,
		items: {
			type: 'object',
			nullable: false, optional: false,
			ref: 'UserDetailed',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		offset: { type: 'integer', default: 0 },
		sort: { type: 'string', enum: ['+createdAt', '-createdAt'] },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		private idService: IdService,
	) {
		super(meta, paramDef, async (ps) => {
			const query = this.userPendingsRepository.createQueryBuilder('user_pending');

			switch (ps.sort) {
				case '+createdAt': query.orderBy('user_pending.id', 'DESC'); break;
				case '-createdAt': query.orderBy('user_pending.id', 'ASC'); break;
				default: query.orderBy('user_pending.id', 'ASC'); break;
			}

			query.limit(ps.limit);
			query.offset(ps.offset);

			const users = await query.getMany();

			return users.map(user => ({
				id: user.id,
				username: user.username,
				createdAt: this.idService.parse(user.id).date.toISOString(),
			})) as SchemaType<{ readonly type: "object"; readonly nullable: false; readonly optional: false; readonly ref: "UserDetailed"; }>[];
		});
	}
}
