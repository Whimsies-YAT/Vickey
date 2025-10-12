/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { ModuleRef } from '@nestjs/core';
import { IsNull, LessThan, MoreThan } from 'typeorm';
import type {
	MiGomokuGame,
	GomokuGamesRepository,
} from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { Serialized } from '@/types.js';
import { GomokuGameEntityService } from './entities/GomokuGameEntityService.js';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

const INVITATION_TIMEOUT_MS = 1000 * 20;
const BOARD_SIZE = 19;

@Injectable()
export class GomokuService implements OnApplicationShutdown, OnModuleInit {
	private notificationService: NotificationService;

	constructor(
		private moduleRef: ModuleRef,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.gomokuGamesRepository)
		private gomokuGamesRepository: GomokuGamesRepository,

		private userEntityService: UserEntityService,
		private globalEventService: GlobalEventService,
		private gomokuGameEntityService: GomokuGameEntityService,
		private idService: IdService,
	) {
	}

	async onModuleInit() {
		this.notificationService = this.moduleRef.get(NotificationService.name);
	}

	@bindThis
	private async cacheGame(game: MiGomokuGame) {
		await this.redisClient.setex(`gomoku:game:cache:${game.id}`, 60 * 60, JSON.stringify(game));
	}

	@bindThis
	private async deleteGameCache(gameId: MiGomokuGame['id']) {
		await this.redisClient.del(`gomoku:game:cache:${gameId}`);
	}

	@bindThis
	public async matchSpecificUser(me: MiUser, targetUser: MiUser): Promise<MiGomokuGame | null> {
		if (targetUser.id === me.id) {
			throw new Error('You cannot match yourself.');
		}

		const games = await this.gomokuGamesRepository.find({
			where: [
				{ id: MoreThan(this.idService.gen(Date.now() - 1000 * 60 * 3)), user1Id: me.id, user2Id: targetUser.id, isStarted: false },
				{ id: MoreThan(this.idService.gen(Date.now() - 1000 * 60 * 3)), user1Id: targetUser.id, user2Id: me.id, isStarted: false },
			],
			relations: ['user1', 'user2'],
			order: { id: 'DESC' },
		});
		if (games.length > 0) {
			return games[0];
		}

		const invitations = await this.redisClient.zrange(
			`gomoku:matchSpecific:${me.id}`,
			Date.now() - INVITATION_TIMEOUT_MS,
			'+inf',
			'BYSCORE');

		if (invitations.includes(targetUser.id)) {
			await this.redisClient.zrem(`gomoku:matchSpecific:${me.id}`, targetUser.id);
			const game = await this.matched(targetUser.id, me.id);
			return game;
		}

		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.zadd(`gomoku:matchSpecific:${targetUser.id}`, Date.now(), me.id);
		redisPipeline.expire(`gomoku:matchSpecific:${targetUser.id}`, 120, 'NX');
		await redisPipeline.exec();

		this.globalEventService.publishGomokuStream(targetUser.id, 'invited', {
			user: await this.userEntityService.pack(me, targetUser),
		});

		return null;
	}

	@bindThis
	public async matchAnyUser(me: MiUser): Promise<MiGomokuGame | null> {
		const games = await this.gomokuGamesRepository.find({
			where: [
				{ id: MoreThan(this.idService.gen(Date.now() - 1000 * 60 * 3)), user1Id: me.id, isStarted: false },
				{ id: MoreThan(this.idService.gen(Date.now() - 1000 * 60 * 3)), user2Id: me.id, isStarted: false },
			],
			relations: ['user1', 'user2'],
			order: { id: 'DESC' },
		});
		if (games.length > 0) {
			return games[0];
		}

		const invitations = await this.redisClient.zrange(
			`gomoku:matchSpecific:${me.id}`,
			Date.now() - INVITATION_TIMEOUT_MS,
			'+inf',
			'BYSCORE');

		if (invitations.length > 0) {
			const invitorId = invitations[Math.floor(Math.random() * invitations.length)];
			await this.redisClient.zrem(`gomoku:matchSpecific:${me.id}`, invitorId);
			const game = await this.matched(invitorId, me.id);
			return game;
		}

		const matchings = await this.redisClient.zrange(
			'gomoku:matchAny',
			0,
			2,
			'REV');

		const items = matchings.filter(id => id !== me.id);

		if (items.length > 0) {
			const matchedUserId = items[0];
			await this.redisClient.zrem('gomoku:matchAny', me.id, matchedUserId);
			const game = await this.matched(matchedUserId, me.id);
			return game;
		} else {
			const redisPipeline = this.redisClient.pipeline();
			redisPipeline.zadd('gomoku:matchAny', Date.now(), me.id);
			redisPipeline.expire('gomoku:matchAny', 15, 'NX');
			await redisPipeline.exec();
			return null;
		}
	}

	@bindThis
	public async matchSpecificUserCancel(user: MiUser, targetUserId: MiUser['id']) {
		await this.redisClient.zrem(`gomoku:matchSpecific:${targetUserId}`, user.id);
	}

	@bindThis
	public async matchAnyUserCancel(user: MiUser) {
		await this.redisClient.zrem('gomoku:matchAny', user.id);
	}

	@bindThis
	public async cleanOutdatedGames() {
		await this.gomokuGamesRepository.delete({
			id: LessThan(this.idService.gen(Date.now() - 1000 * 60 * 10)),
			isStarted: false,
		});
	}

	@bindThis
	public async gameReady(gameId: MiGomokuGame['id'], user: MiUser, ready: boolean) {
		const game = await this.get(gameId);
		if (game == null) throw new Error('game not found');
		if (game.isStarted) return;

		let isBothReady = false;

		if (game.user1Id === user.id) {
			const updatedGame = {
				...game,
				user1Ready: ready,
			};
			this.cacheGame(updatedGame);

			this.globalEventService.publishGomokuGameStream(game.id, 'changeReadyStates', {
				user1: ready,
				user2: updatedGame.user2Ready,
			});

			if (ready && updatedGame.user2Ready) isBothReady = true;
		} else if (game.user2Id === user.id) {
			const updatedGame = {
				...game,
				user2Ready: ready,
			};
			this.cacheGame(updatedGame);

			this.globalEventService.publishGomokuGameStream(game.id, 'changeReadyStates', {
				user1: updatedGame.user1Ready,
				user2: ready,
			});

			if (ready && updatedGame.user1Ready) isBothReady = true;
		} else {
			return;
		}

		if (isBothReady) {
			setTimeout(async () => {
				const freshGame = await this.get(game.id);
				if (freshGame == null || freshGame.isStarted || freshGame.isEnded) return;
				if (!freshGame.user1Ready || !freshGame.user2Ready) return;

				this.startGame(freshGame);
			}, 3000);
		}
	}

	@bindThis
	private async matched(parentId: MiUser['id'], childId: MiUser['id']): Promise<MiGomokuGame> {
		const game = await this.gomokuGamesRepository.insertOne({
			id: this.idService.gen(),
			createdAt: new Date(),
			user1Id: parentId,
			user2Id: childId,
			user1Ready: false,
			user2Ready: false,
			isStarted: false,
			isEnded: false,
			board: Array(BOARD_SIZE * BOARD_SIZE).fill(0),
			logs: [],
		}, { relations: ['user1', 'user2'] });
		this.cacheGame(game);

		const packed = await this.gomokuGameEntityService.packDetail(game);
		this.globalEventService.publishGomokuStream(parentId, 'matched', { game: packed });

		return game;
	}

	@bindThis
	private async startGame(game: MiGomokuGame) {
		const black = Math.random() > 0.5 ? 1 : 2;

		const updatedGame = await this.gomokuGamesRepository.createQueryBuilder().update()
			.set({
				startedAt: new Date(),
				isStarted: true,
				black: black,
				board: Array(BOARD_SIZE * BOARD_SIZE).fill(0),
			})
			.where('id = :id', { id: game.id })
			.returning('*')
			.execute()
			.then((response) => response.raw[0]);

		updatedGame.user1 = game.user1;
		updatedGame.user2 = game.user2;
		this.cacheGame(updatedGame);

		this.globalEventService.publishGomokuGameStream(game.id, 'started', {
			game: await this.gomokuGameEntityService.packDetail(updatedGame),
		});
	}

	@bindThis
	private async endGame(game: MiGomokuGame, winnerId: MiUser['id'] | null, reason: 'surrender' | null) {
		const updatedGame = await this.gomokuGamesRepository.createQueryBuilder().update()
			.set({
				isEnded: true,
				endedAt: new Date(),
				winnerId: winnerId,
				surrenderedUserId: reason === 'surrender' ? (winnerId === game.user1Id ? game.user2Id : game.user1Id) : null,
				board: game.board,
				logs: game.logs,
			})
			.where('id = :id', { id: game.id })
			.returning('*')
			.execute()
			.then((response) => response.raw[0]);

		updatedGame.user1 = game.user1;
		updatedGame.user2 = game.user2;
		this.cacheGame(updatedGame);

		this.globalEventService.publishGomokuGameStream(game.id, 'ended', {
			winnerId: winnerId,
			game: await this.gomokuGameEntityService.packDetail(updatedGame),
		});
	}

	@bindThis
	public async getInvitations(user: MiUser): Promise<MiUser['id'][]> {
		const invitations = await this.redisClient.zrange(
			`gomoku:matchSpecific:${user.id}`,
			Date.now() - INVITATION_TIMEOUT_MS,
			'+inf',
			'BYSCORE');
		return invitations;
	}

	@bindThis
	private checkWin(board: number[], index: number): boolean {
		const player = board[index];
		if (player === 0) return false;

		const row = Math.floor(index / BOARD_SIZE);
		const col = index % BOARD_SIZE;

		const directions = [
			[1, 0],
			[0, 1],
			[1, 1],
			[1, -1],
		];

		for (const [dr, dc] of directions) {
			let count = 1;

			for (let i = 1; i < 5; i++) {
				const r = row + dr * i;
				const c = col + dc * i;
				if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
				if (board[r * BOARD_SIZE + c] !== player) break;
				count++;
			}

			for (let i = 1; i < 5; i++) {
				const r = row - dr * i;
				const c = col - dc * i;
				if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
				if (board[r * BOARD_SIZE + c] !== player) break;
				count++;
			}

			if (count >= 5) return true;
		}

		return false;
	}

	@bindThis
	public async putStone(gameId: MiGomokuGame['id'], user: MiUser, pos: number) {
		const game = await this.get(gameId);
		if (game == null) throw new Error('game not found');
		if (!game.isStarted) return;
		if (game.isEnded) return;
		if ((game.user1Id !== user.id) && (game.user2Id !== user.id)) return;

		const currentTurn = game.logs.length % 2 === 0 ? game.black : (game.black === 1 ? 2 : 1);
		const myTurn = (game.user1Id === user.id && currentTurn === 1) || (game.user2Id === user.id && currentTurn === 2);
		if (!myTurn) return;

		if (pos < 0 || pos >= BOARD_SIZE * BOARD_SIZE) return;
		if (game.board[pos] !== 0) return;

		const newBoard = [...game.board];
		newBoard[pos] = currentTurn;

		const log: [number, number] = [pos, currentTurn];
		const newLogs = [...game.logs, log];

		const updatedGame = {
			...game,
			board: newBoard,
			logs: newLogs,
		};
		this.cacheGame(updatedGame);

		this.globalEventService.publishGomokuGameStream(game.id, 'log', log);

		if (this.checkWin(newBoard, pos)) {
			const winnerId = currentTurn === 1 ? game.user1Id : game.user2Id;
			await this.endGame(updatedGame, winnerId, null);
		} else if (newBoard.every(cell => cell !== 0)) {
			await this.endGame(updatedGame, null, null);
		}
	}

	@bindThis
	public async surrender(gameId: MiGomokuGame['id'], user: MiUser) {
		const game = await this.get(gameId);
		if (game == null) throw new Error('game not found');
		if (game.isEnded) return;
		if ((game.user1Id !== user.id) && (game.user2Id !== user.id)) return;

		const winnerId = game.user1Id === user.id ? game.user2Id : game.user1Id;

		await this.endGame(game, winnerId, 'surrender');
	}

	@bindThis
	public async cancelGame(gameId: MiGomokuGame['id'], user: MiUser) {
		const game = await this.get(gameId);
		if (game == null) throw new Error('game not found');
		if (game.isStarted) return;
		if ((game.user1Id !== user.id) && (game.user2Id !== user.id)) return;

		await this.gomokuGamesRepository.delete(game.id);
		this.deleteGameCache(game.id);

		this.globalEventService.publishGomokuGameStream(game.id, 'canceled', {
			userId: user.id,
		});
	}

	@bindThis
	public async get(id: MiGomokuGame['id']): Promise<MiGomokuGame | null> {
		const cached = await this.redisClient.get(`gomoku:game:cache:${id}`);
		if (cached != null) {
			const parsed = JSON.parse(cached) as Serialized<MiGomokuGame>;
			return {
				...parsed,
				createdAt: parsed.createdAt != null ? new Date(parsed.createdAt) : new Date(),
				startedAt: parsed.startedAt != null ? new Date(parsed.startedAt) : null,
				endedAt: parsed.endedAt != null ? new Date(parsed.endedAt) : null,
				user1: parsed.user1 != null ? {
					...parsed.user1,
					avatar: null,
					banner: null,
					updatedAt: parsed.user1.updatedAt != null ? new Date(parsed.user1.updatedAt) : null,
					lastActiveDate: parsed.user1.lastActiveDate != null ? new Date(parsed.user1.lastActiveDate) : null,
					lastFetchedAt: parsed.user1.lastFetchedAt != null ? new Date(parsed.user1.lastFetchedAt) : null,
					movedAt: parsed.user1.movedAt != null ? new Date(parsed.user1.movedAt) : null,
					riskScoreUpdatedAt: parsed.user1.riskScoreUpdatedAt != null ? new Date(parsed.user1.riskScoreUpdatedAt) : null,
				} : null,
				user2: parsed.user2 != null ? {
					...parsed.user2,
					avatar: null,
					banner: null,
					updatedAt: parsed.user2.updatedAt != null ? new Date(parsed.user2.updatedAt) : null,
					lastActiveDate: parsed.user2.lastActiveDate != null ? new Date(parsed.user2.lastActiveDate) : null,
					lastFetchedAt: parsed.user2.lastFetchedAt != null ? new Date(parsed.user2.lastFetchedAt) : null,
					movedAt: parsed.user2.movedAt != null ? new Date(parsed.user2.movedAt) : null,
					riskScoreUpdatedAt: parsed.user2.riskScoreUpdatedAt != null ? new Date(parsed.user2.riskScoreUpdatedAt) : null,
				} : null,
			};
		} else {
			const game = await this.gomokuGamesRepository.findOne({
				where: { id },
				relations: ['user1', 'user2'],
			});
			if (game == null) return null;

			this.cacheGame(game);

			return game;
		}
	}

	@bindThis
	public dispose(): void {
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
