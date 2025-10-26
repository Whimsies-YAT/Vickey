/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { WerewolfGameEntityService } from '@/core/entities/WerewolfGameEntityService.js';
import { DI } from '@/di-symbols.js';
import type { WerewolfGamesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';

export const meta = {
	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: { ref: 'WerewolfGameLite' },
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
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,

		private werewolfGameEntityService: WerewolfGameEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.werewolfGamesRepository.createQueryBuilder('game'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.innerJoinAndSelect('game.host', 'host');

			if (ps.my && me) {
				query.andWhere(new Brackets(qb => {
					qb.where('game.hostId = :userId', { userId: me.id })
						.orWhere('game.players @> :player', { player: JSON.stringify([{ userId: me.id }]) })
						.orWhere(`EXISTS (
							SELECT 1 FROM jsonb_array_elements(game.seats) AS seat
							WHERE seat->>'userId' = :userId
						)`, { userId: me.id });
				}));
			} else {
				query.andWhere('game.isStarted = FALSE OR game.isEnded = TRUE');

				if (me) {
					query.andWhere(new Brackets(qb => {
						qb.where('game.hostId != :userId', { userId: me.id })
							.andWhere('NOT (game.players @> :player)', { player: JSON.stringify([{ userId: me.id }]) })
							.andWhere(`NOT EXISTS (
								SELECT 1 FROM jsonb_array_elements(game.seats) AS seat
								WHERE seat->>'userId' = :userId
							)`, { userId: me.id });
					}));
				}
			}

			const games = await query.take(ps.limit).getMany();

			return await this.werewolfGameEntityService.packLiteMany(games);
		});
	}
}
