/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { WerewolfGamesRepository } from '@/models/_.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiWerewolfGame } from '@/models/WerewolfGame.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from './UserEntityService.js';

@Injectable()
export class WerewolfGameEntityService {
	constructor(
		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
	) {
	}

	@bindThis
	public async packDetail(
		src: MiWerewolfGame['id'] | MiWerewolfGame,
		hint?: {
			packedHost?: Packed<'UserLite'>,
			packedPlayers?: Map<string, Packed<'UserLite'>>,
		},
	): Promise<Packed<'WerewolfGameDetailed'>> {
		const game = typeof src === 'object' ? src : await this.werewolfGamesRepository.findOneByOrFail({ id: src });

		const host = hint?.packedHost ?? await this.userEntityService.pack(game.host ?? game.hostId);

		const playerIds = game.players.map(p => p.userId);
		const packedPlayers = hint?.packedPlayers ?? await this.userEntityService.packMany(playerIds)
			.then(users => new Map(users.map(u => [u.id, u])));

		const players = game.players.map(p => ({
			...p,
			user: packedPlayers!.get(p.userId)!,
		}));

		return await awaitAll({
			id: game.id,
			createdAt: this.idService.parse(game.id).date.toISOString(),
			startedAt: game.startedAt && game.startedAt.toISOString(),
			endedAt: game.endedAt && game.endedAt.toISOString(),
			isStarted: game.isStarted,
			isEnded: game.isEnded,
			hostId: game.hostId,
			host,
			config: game.config,
			phase: game.phase,
			subPhase: game.subPhase,
			dayNumber: game.dayNumber,
			seats: game.seats,
			readyPlayers: game.readyPlayers,
			players,
			allPlayers: Array.from(packedPlayers!.values()),
			winnerTeam: game.winnerTeam,
			logs: game.logs,
			currentActions: game.currentActions,
			voiceSessionId: null,
			phaseStartedAt: game.phaseStartedAt && game.phaseStartedAt.toISOString(),
			phaseEndsAt: game.phaseEndsAt && game.phaseEndsAt.toISOString(),
		});
	}

	@bindThis
	public async packDetailMany(
		games: MiWerewolfGame[],
	) {
		const allPlayerIds = Array.from(new Set(games.flatMap(g => g.players.map(p => p.userId))));
		const allHostIds = games.map(g => g.host ?? g.hostId);
		const _userMap = await this.userEntityService.packMany([...allHostIds, ...allPlayerIds])
			.then(users => new Map(users.map(u => [u.id, u])));

		return Promise.all(
			games.map(game => {
				return this.packDetail(game, {
					packedHost: _userMap.get(game.hostId),
					packedPlayers: _userMap,
				});
			}),
		);
	}

	@bindThis
	public async packLite(
		src: MiWerewolfGame['id'] | MiWerewolfGame,
		hint?: {
			packedHost?: Packed<'UserLite'>,
		},
	): Promise<Packed<'WerewolfGameLite'>> {
		const game = typeof src === 'object' ? src : await this.werewolfGamesRepository.findOneByOrFail({ id: src });

		const host = hint?.packedHost ?? await this.userEntityService.pack(game.host ?? game.hostId);

		return await awaitAll({
			id: game.id,
			createdAt: this.idService.parse(game.id).date.toISOString(),
			startedAt: game.startedAt && game.startedAt.toISOString(),
			endedAt: game.endedAt && game.endedAt.toISOString(),
			isStarted: game.isStarted,
			isEnded: game.isEnded,
			hostId: game.hostId,
			host,
			mode: game.config.mode,
			maxPlayers: game.config.maxPlayers,
			currentPlayers: game.players.length,
			winnerTeam: game.winnerTeam,
			phase: game.phase, // Required for getPlayerCount()
			seats: game.seats, // Required for getPlayerCount()
			players: game.players, // Required for getPlayerCount()
		});
	}

	@bindThis
	public async packLiteMany(
		games: MiWerewolfGame[],
	) {
		const _hosts = games.map(({ host, hostId }) => host ?? hostId);
		const _userMap = await this.userEntityService.packMany(_hosts)
			.then(users => new Map(users.map(u => [u.id, u])));

		return Promise.all(
			games.map(game => {
				return this.packLite(game, {
					packedHost: _userMap.get(game.hostId),
				});
			}),
		);
	}
}
