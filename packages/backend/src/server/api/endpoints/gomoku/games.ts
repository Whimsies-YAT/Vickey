/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GomokuGameEntityService } from '@/core/entities/GomokuGameEntityService.js';
import { DI } from '@/di-symbols.js';
import type { GomokuGamesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';

export const meta = {
	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: { ref: 'GomokuGameLite' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		my: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.gomokuGamesRepository)
		private gomokuGamesRepository: GomokuGamesRepository,

		private gomokuGameEntityService: GomokuGameEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.gomokuGamesRepository.createQueryBuilder('game'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.innerJoinAndSelect('game.user1', 'user1')
				.innerJoinAndSelect('game.user2', 'user2');

			if (ps.my && me) {
				query.andWhere(new Brackets(qb => {
					qb
						.where('game.user1Id = :userId', { userId: me.id })
						.orWhere('game.user2Id = :userId', { userId: me.id });
				}));
			} else {
				query.andWhere('game.isStarted = TRUE');
			}

			const games = await query.take(ps.limit).getMany();

			return await this.gomokuGameEntityService.packLiteMany(games);
		});
	}
}
