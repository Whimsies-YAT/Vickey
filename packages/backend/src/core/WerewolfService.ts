/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type {
	MiWerewolfGame,
	WerewolfGamesRepository,
} from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { WerewolfGameMode, WerewolfGameConfig, WerewolfRole, WerewolfTeam } from '@/models/WerewolfGame.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { IdService } from '@/core/IdService.js';
import { CloudflareCallsService } from '@/core/CloudflareCallsService.js';
import { WerewolfVoiceService } from '@/core/WerewolfVoiceService.js';
import { Serialized } from '@/types.js';
import { WerewolfGameEntityService } from './entities/WerewolfGameEntityService.js';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

const GAME_CACHE_TTL = 60 * 60;
const PRESET_6_ROLES: WerewolfRole[] = ['seer', 'witch', 'villager', 'villager', 'werewolf', 'werewolf'];
const PRESET_9_ROLES: WerewolfRole[] = ['seer', 'witch', 'hunter', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'werewolf'];
const SPEECH_TIME_LIMIT = 60;
const TESTAMENT_TIME_LIMIT = 30;
const NIGHT_ACTION_TIME_LIMIT = 60;
const VOTING_TIME_LIMIT = 15;
const MAX_ROUNDS = 15;

type ActionProcessMode = 'vote' | 'single' | 'none';

interface RoleAbilityConfig {
	limited?: boolean;
	maxUses?: number;
	stateKey?: string;
	requiresCondition?: (game: MiWerewolfGame, player: any) => boolean;
}

interface TimeWindow {
	name: string;
	startSec: number;
	endSec: number;
	allowedActions: string[];
	uiCondition?: (game: MiWerewolfGame, player: any) => Record<string, any> | false;
}

interface RoleConfig {
	name: WerewolfRole;
	team: WerewolfTeam;
	nightTurn: number | null;
	allowedActions: {
		night?: string[];
		voting?: string[];
	};
	processMode: ActionProcessMode;
	abilities?: Record<string, RoleAbilityConfig>;
	initialState?: Record<string, any>;
	nightActionDuration?: number;
	timeWindows?: TimeWindow[];
}

const ROLE_CONFIGS: Record<WerewolfRole, RoleConfig> = {
	werewolf: {
		name: 'werewolf',
		team: 'werewolf',
		nightTurn: 1,
		allowedActions: { night: ['kill', 'skip'], voting: ['vote'] },
		processMode: 'vote',
		nightActionDuration: 30,
	},
	witch: {
		name: 'witch',
		team: 'villager',
		nightTurn: 3,
		allowedActions: { night: ['heal', 'poison', 'skip'], voting: ['vote'] },
		processMode: 'single',
		abilities: {
			heal: {
				limited: true,
				maxUses: 1,
				stateKey: 'healUsed',
				requiresCondition: (game) => game.nightKillTarget != null,
			},
			poison: {
				limited: true,
				maxUses: 1,
				stateKey: 'poisonUsed',
			},
		},
		initialState: { poisonUsed: false, healUsed: false },
		nightActionDuration: 25,
		timeWindows: [
			{
				name: 'heal_window',
				startSec: 0,
				endSec: 12,
				allowedActions: ['heal', 'skip'],
				uiCondition: (game: MiWerewolfGame, player: any) => {
					if (player.roleState.healUsed) return false;
					const isFirstNight = game.dayNumber === 0;
					return {
						canSeeKillTarget: !player.roleState.healUsed,
						canSelfHeal: isFirstNight,
						hasAntidote: !player.roleState.healUsed,
						nightKillTarget: game.nightKillTarget,
					};
				},
			},
			{
				name: 'poison_window',
				startSec: 13,
				endSec: 25,
				allowedActions: ['poison', 'skip'],
				uiCondition: (game: MiWerewolfGame, player: any) => {
					const usedHealThisNight = game.currentActions[player.userId]?.action === 'heal';
					if (usedHealThisNight || player.roleState.poisonUsed) return false;
					return {
						hasPoison: !player.roleState.poisonUsed,
						canUse: !usedHealThisNight,
					};
				},
			},
		],
	},
	seer: {
		name: 'seer',
		team: 'villager',
		nightTurn: 4,
		allowedActions: { night: ['check', 'skip'], voting: ['vote'] },
		processMode: 'single',
		initialState: { checkedPlayers: [] },
		nightActionDuration: 15,
	},
	hunter: {
		name: 'hunter',
		team: 'villager',
		nightTurn: null,
		allowedActions: { voting: ['vote'] },
		processMode: 'none',
		initialState: { shotUsed: false },
	},
	villager: {
		name: 'villager',
		team: 'villager',
		nightTurn: null,
		allowedActions: { voting: ['vote'] },
		processMode: 'none',
	},
	guard: {
		name: 'guard',
		team: 'villager',
		nightTurn: 2,
		allowedActions: { night: ['protect', 'skip'], voting: ['vote'] },
		processMode: 'single',
		initialState: { lastProtected: null },
		nightActionDuration: 15,
	},
	idiot: {
		name: 'idiot',
		team: 'villager',
		nightTurn: null,
		allowedActions: { voting: ['vote'] },
		processMode: 'none',
		initialState: { revealed: false, canVote: true },
	},
};

const NIGHT_PHASE_ORDER = Object.values(ROLE_CONFIGS)
	.filter(config => config.nightTurn !== null)
	.sort((a, b) => a.nightTurn! - b.nightTurn!)
	.map(config => `${config.name}_turn`);

@Injectable()
export class WerewolfService implements OnApplicationShutdown, OnModuleInit {
	private speechTimers: Map<string, NodeJS.Timeout> = new Map();
	private countdownTimers: Map<string, NodeJS.Timeout> = new Map();
	private readyKickTimers: Map<string, NodeJS.Timeout> = new Map();
	private nightPhaseTimers: Map<string, NodeJS.Timeout> = new Map();
	private votingTimers: Map<string, NodeJS.Timeout> = new Map();
	private hunterShootingTimers: Map<string, NodeJS.Timeout> = new Map();

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.werewolfGamesRepository)
		private werewolfGamesRepository: WerewolfGamesRepository,

		private globalEventService: GlobalEventService,
		private werewolfGameEntityService: WerewolfGameEntityService,
		private cloudflareCallsService: CloudflareCallsService,
		private werewolfVoiceService: WerewolfVoiceService,
		private idService: IdService,
	) {
	}

	async onModuleInit() {
		const activeGames = await this.werewolfGamesRepository.find({
			where: {
				isStarted: true,
				isEnded: false,
			},
		});

		for (const game of activeGames) {
			if (game.phase === 'night' && game.subPhase) {
				this.startNightPhaseTimer(game.id);
			} else if ((game.phase === 'day' || game.phase === 'testament') && game.currentSpeaker && game.speakerStartTime) {
				const isTestament = game.phase === 'testament';
				const timeLimit = isTestament ? TESTAMENT_TIME_LIMIT : SPEECH_TIME_LIMIT;
				this.startSpeechTimer(game.id, timeLimit, isTestament);
			} else if (game.phase === 'voting') {
				this.startVotingTimer(game.id);
			}
		}
	}

	@bindThis
	private async cacheGame(game: MiWerewolfGame) {
		await this.redisClient.setex(`werewolf:game:cache:${game.id}`, GAME_CACHE_TTL, JSON.stringify(game));
	}

	@bindThis
	private async deleteGameCache(gameId: MiWerewolfGame['id']) {
		await this.redisClient.del(`werewolf:game:cache:${gameId}`);
	}

	@bindThis
	public async get(id: MiWerewolfGame['id']): Promise<MiWerewolfGame | null> {
		const cached = await this.redisClient.get(`werewolf:game:cache:${id}`);
		if (cached != null) {
			const parsed = JSON.parse(cached) as Serialized<MiWerewolfGame>;
			return {
				...parsed,
				createdAt: parsed.createdAt != null ? new Date(parsed.createdAt) : new Date(),
				startedAt: parsed.startedAt != null ? new Date(parsed.startedAt) : null,
				endedAt: parsed.endedAt != null ? new Date(parsed.endedAt) : null,
				phaseStartedAt: parsed.phaseStartedAt != null ? new Date(parsed.phaseStartedAt) : null,
				phaseEndsAt: parsed.phaseEndsAt != null ? new Date(parsed.phaseEndsAt) : null,
				speakerStartTime: parsed.speakerStartTime != null ? new Date(parsed.speakerStartTime) : null,
				speechTimeoutAt: parsed.speechTimeoutAt != null ? new Date(parsed.speechTimeoutAt) : null,
				countdownStartedAt: parsed.countdownStartedAt != null ? new Date(parsed.countdownStartedAt) : null,
				logs: parsed.logs.map(log => ({
					...log,
					timestamp: log.timestamp != null ? new Date(log.timestamp as unknown as string) : undefined,
				})),
				host: parsed.host != null ? {
					...parsed.host,
					avatar: null,
					banner: null,
					updatedAt: parsed.host.updatedAt != null ? new Date(parsed.host.updatedAt) : null,
					lastActiveDate: parsed.host.lastActiveDate != null ? new Date(parsed.host.lastActiveDate) : null,
					lastFetchedAt: parsed.host.lastFetchedAt != null ? new Date(parsed.host.lastFetchedAt) : null,
					movedAt: parsed.host.movedAt != null ? new Date(parsed.host.movedAt) : null,
					riskScoreUpdatedAt: parsed.host.riskScoreUpdatedAt != null ? new Date(parsed.host.riskScoreUpdatedAt) : null,
				} : null,
			};
		} else {
			const game = await this.werewolfGamesRepository.findOne({
				where: { id },
				relations: ['host'],
			});
			if (game == null) return null;

			await this.cacheGame(game);

			return game;
		}
	}

	@bindThis
	private computeRoleTimeWindowState(
		game: MiWerewolfGame,
		player: any,
		roleConfig: any,
		elapsed: number,
	): { window: string; windowRemaining: number; allowedActions: string[]; uiState: any; hasSubmitted: boolean } | null {
		if (!roleConfig?.timeWindows) return null;

		const activeWindow = roleConfig.timeWindows.find(
			(w: TimeWindow) => elapsed >= w.startSec && elapsed < w.endSec,
		);

		if (activeWindow) {
			const windowRemaining = activeWindow.endSec - elapsed;
			const uiConditionResult = activeWindow.uiCondition
				? activeWindow.uiCondition(game, player)
				: {};
			const uiState = uiConditionResult === false ? {} : uiConditionResult;

			return {
				window: activeWindow.name,
				windowRemaining,
				allowedActions: activeWindow.allowedActions,
				uiState,
				hasSubmitted: game.currentActions[player.userId] != null,
			};
		} else {
			return {
				window: 'transition',
				windowRemaining: 0,
				allowedActions: [],
				uiState: {},
				hasSubmitted: game.currentActions[player.userId] != null,
			};
		}
	}

	@bindThis
	public getRoleUiState(game: MiWerewolfGame, userId: string): Record<string, any> | null {
		if (!game.isStarted || game.isEnded) return null;

		const player = game.players?.find(p => p.userId === userId);
		if (!player || !player.role) return null;

		const roleConfig = ROLE_CONFIGS[player.role];
		if (!roleConfig) return null;

		const baseState = {
			role: player.role,
			isAlive: player.isAlive,
			roleState: player.roleState || {},
		};

		if (!player.isAlive) {
			return baseState;
		}

		if (game.phase === 'night' && game.subPhase === `${player.role}_turn`) {
			if (roleConfig.timeWindows && game.phaseStartedAt) {
				const elapsed = Math.floor((Date.now() - game.phaseStartedAt.getTime()) / 1000);
				const timeWindowState = this.computeRoleTimeWindowState(game, player, roleConfig, elapsed);
				if (timeWindowState) {
					return { ...baseState, ...timeWindowState, subPhase: game.subPhase };
				}
			}

			return {
				...baseState,
				subPhase: game.subPhase,
				allowedActions: roleConfig.allowedActions?.night || [],
				hasSubmitted: game.currentActions[userId] != null,
			};
		}

		if (game.phase === 'day' && game.subPhase === 'discussion') {
			return {
				...baseState,
				phase: 'day',
				subPhase: 'discussion',
				currentSpeaker: game.currentSpeaker,
				isCurrentSpeaker: game.currentSpeaker === userId,
				speechOrder: game.speechOrder,
			};
		}

		if (game.phase === 'voting') {
			return {
				...baseState,
				phase: 'voting',
				votingRound: game.votingRound,
				tiedPlayers: game.tiedPlayers,
				hasVoted: game.currentActions[userId] != null,
				allowedActions: roleConfig.allowedActions?.voting || [],
			};
		}

		if (game.phase === 'testament') {
			return {
				...baseState,
				phase: 'testament',
				currentSpeaker: game.currentSpeaker,
				isCurrentSpeaker: game.currentSpeaker === userId,
				testamentQueue: game.testamentQueue,
			};
		}

		return baseState;
	}

	@bindThis
	private getDefaultConfig(mode: WerewolfGameMode): WerewolfGameConfig {
		const roles = mode === 'preset_6' ? PRESET_6_ROLES : mode === 'preset_9' ? PRESET_9_ROLES : [];

		return {
			mode,
			maxPlayers: roles.length,
			roles,
			rules: {
				gameMode: 'slaughter_all_sides',
				playingCardMode: 'closed',
				witchSelfHealFirstNight: true,
				hunterCanShootWhenPoisoned: false,
				dayDiscussionTime: 300,
				votingTime: 60,
			},
			voiceEnabled: true,
			chatEnabled: true,
		};
	}

	@bindThis
	private initializeSeats(maxPlayers: number): any[] {
		const seats = [];
		for (let i = 0; i < 12; i++) {
			seats.push({
				seatNumber: i,
				userId: null,
				locked: i >= maxPlayers,
			});
		}
		return seats;
	}

	@bindThis
	public async createGame(host: MiUser, mode: WerewolfGameMode, customConfig?: Partial<WerewolfGameConfig>): Promise<MiWerewolfGame> {
		const config = customConfig ? { ...this.getDefaultConfig(mode), ...customConfig } : this.getDefaultConfig(mode);

		config.voiceEnabled = this.werewolfVoiceService.isEnabled();

		const game = await this.werewolfGamesRepository.insertOne({
			id: this.idService.gen(),
			createdAt: new Date(),
			hostId: host.id,
			isStarted: false,
			isEnded: false,
			config,
			phase: 'waiting',
			subPhase: null,
			dayNumber: 0,
			players: [],
			seats: this.initializeSeats(config.maxPlayers),
			winnerTeam: null,
			logs: [],
			currentActions: {},
			voiceAppId: null,
			voiceAppSecret: null,
			playerVoiceSessions: {},
			phaseStartedAt: null,
			phaseEndsAt: null,
			speechTimeRemaining: null,
			speechTimeoutAt: null,
			readyPlayers: [],
			isCountingDown: false,
			countdownStartedAt: null,
			tiedPlayers: [],
			votingRound: 1,
		}, { relations: ['host'] });

		await this.cacheGame(game);

		this.globalEventService.publishWerewolfLobbyStream('matched', {
			game: await this.werewolfGameEntityService.packDetail(game),
		});

		return game;
	}

	@bindThis
	public async takeSeat(gameId: MiWerewolfGame['id'], user: MiUser, seatNumber: number): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || game.isStarted || game.isEnded) return false;

		if (game.readyPlayers.includes(user.id)) return false;

		if (seatNumber < 0 || seatNumber >= 12) return false;

		const targetSeat = game.seats[seatNumber];
		if (!targetSeat || targetSeat.locked || targetSeat.userId != null) return false;

		const currentSeatIndex = game.seats.findIndex(s => s.userId === user.id);
		if (currentSeatIndex !== -1) {
			game.seats[currentSeatIndex].userId = null;
		}

		targetSeat.userId = user.id;

		const playerIndex = game.players.findIndex(p => p.userId === user.id);
		if (playerIndex !== -1) {
			game.players[playerIndex].seat = seatNumber;
		} else {
			game.players.push({
				userId: user.id,
				seat: seatNumber,
				role: null,
				team: null,
				isAlive: true,
				roleState: {},
			});
		}

		await this.werewolfGamesRepository.update(game.id, {
			seats: game.seats,
			players: game.players,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'seatChanged', {
			seats: game.seats,
			players: game.players,
			userId: user.id,
			seatNumber,
		});

		const occupiedSeats = game.seats.filter(s => !s.locked && s.userId != null).length;
		if (occupiedSeats === game.config.maxPlayers) {
			for (const player of game.players) {
				if (!game.readyPlayers.includes(player.userId)) {
					await this.startReadyKickTimer(game.id, player.userId);
				}
			}
		}

		return true;
	}

	@bindThis
	public async leaveSeat(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || game.isStarted) return false;

		if (game.hostId === user.id) {
			this.clearCountdown(game.id);
			this.clearReadyKickTimersForGame(game.id);

			if (game.config.voiceEnabled) {
				await this.werewolfVoiceService.cleanupVoiceSession(game.id);
			}

			const packedGame = await this.werewolfGameEntityService.packLite(game);

			await this.werewolfGamesRepository.delete(game.id);
			await this.deleteGameCache(game.id);
			this.globalEventService.publishWerewolfGameStream(game.id, 'gameCanceled', {});

			this.globalEventService.publishWerewolfLobbyStream('canceled', {
				game: packedGame,
			});

			return true;
		}

		const currentSeatIndex = game.seats.findIndex(s => s.userId === user.id);
		if (currentSeatIndex === -1) return false;

		game.seats[currentSeatIndex].userId = null;

		const playerIndex = game.players.findIndex(p => p.userId === user.id);
		if (playerIndex !== -1) {
			game.players.splice(playerIndex, 1);
		}

		if (game.playerVoiceSessions && game.playerVoiceSessions[user.id]) {
			delete game.playerVoiceSessions[user.id];
		}

		const wasReady = game.readyPlayers.includes(user.id);
		game.readyPlayers = game.readyPlayers.filter(id => id !== user.id);

		if (wasReady && game.isCountingDown) {
			this.clearCountdown(game.id);
			game.isCountingDown = false;
			game.countdownStartedAt = null;
		}

		const kickTimerKey = `${gameId}:${user.id}`;
		const kickTimer = this.readyKickTimers.get(kickTimerKey);
		if (kickTimer) {
			clearTimeout(kickTimer);
			this.readyKickTimers.delete(kickTimerKey);
		}

		await this.werewolfGamesRepository.update(game.id, {
			seats: game.seats,
			players: game.players,
			readyPlayers: game.readyPlayers,
			isCountingDown: game.isCountingDown,
			countdownStartedAt: game.countdownStartedAt,
			playerVoiceSessions: game.playerVoiceSessions,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'seatChanged', {
			seats: game.seats,
			players: game.players,
			userId: user.id,
			seatNumber: null,
		});

		return true;
	}

	@bindThis
	private async autoStartGame(game: MiWerewolfGame): Promise<void> {
		if (game.isStarted || game.isEnded) return;

		await this.assignRoles(game);

		if (game.config.voiceEnabled) {
			await this.werewolfVoiceService.initializeVoiceSession(game.id);
		}

		game.isStarted = true;
		game.startedAt = new Date();
		game.phase = 'night';
		game.subPhase = 'werewolf_turn';
		game.phaseStartedAt = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			players: game.players,
			isStarted: true,
			startedAt: game.startedAt,
			phase: game.phase,
			subPhase: game.subPhase,
			phaseStartedAt: game.phaseStartedAt,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'gameStarted', {
			game: await this.werewolfGameEntityService.packDetail(game),
		});

		this.startNightPhaseTimer(game.id);
	}

	@bindThis
	public async joinGame(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || game.isStarted || game.isEnded) return false;

		if (game.players.some(p => p.userId === user.id)) return false;

		const firstAvailableSeat = game.seats.findIndex(s => !s.locked && s.userId == null);
		if (firstAvailableSeat === -1) return false;

		return await this.takeSeat(gameId, user, firstAvailableSeat);
	}

	@bindThis
	public async leaveGame(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		return await this.leaveSeat(gameId, user);
	}

	@bindThis
	private async assignRoles(game: MiWerewolfGame): Promise<void> {
		const roles = [...game.config.roles];
		const shuffled = roles.sort(() => Math.random() - 0.5);

		game.players.forEach((player, index) => {
			const role = shuffled[index];
			player.role = role;
			player.team = role === 'werewolf' ? 'werewolf' : 'villager';
			player.roleState = this.getInitialRoleState(role);
		});
	}

	@bindThis
	private getInitialRoleState(role: WerewolfRole): Record<string, any> {
		const config = ROLE_CONFIGS[role];
		return config?.initialState ? { ...config.initialState } : {};
	}

	@bindThis
	public async performAction(gameId: MiWerewolfGame['id'], user: MiUser, action: string, target?: string): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;

		const player = game.players.find(p => p.userId === user.id);
		if (!player) return false;

		if (game.phase === 'hunter_shooting') {
			if (player.role !== 'hunter' || player.isAlive || player.roleState.shotUsed) return false;
			await this.processHunterShot(game, target);
			return true;
		}

		if (!player.isAlive) return false;

		const isActionAllowed = this.validateActionPermission(game, player, action, target);
		if (!isActionAllowed) {
			return false;
		}

		game.currentActions[user.id] = { action, target };

		await this.werewolfGamesRepository.update(game.id, { currentActions: game.currentActions });
		await this.cacheGame(game);

		await this.checkPhaseComplete(game);

		return true;
	}

	@bindThis
	private validateActionPermission(game: MiWerewolfGame, player: any, action: string, target?: string): boolean {
		const { phase, subPhase } = game;
		const { role } = player;

		const config = ROLE_CONFIGS[role as WerewolfRole];
		if (!config) return false;

		if (phase === 'night' && subPhase) {
			const expectedSubPhase = `${role}_turn`;
			if (subPhase !== expectedSubPhase) return false;

			const isActionAllowed = config.allowedActions.night?.includes(action) ?? false;
			if (!isActionAllowed) return false;

			if (config.timeWindows && game.phaseStartedAt) {
				const now = Date.now();
				const phaseStartTime = game.phaseStartedAt.getTime();
				const elapsed = Math.floor((now - phaseStartTime) / 1000);

				const activeWindow = config.timeWindows.find(
					(w: TimeWindow) => elapsed >= w.startSec && elapsed < w.endSec
				);

				if (!activeWindow) {
					return false;
				}

				if (!activeWindow.allowedActions.includes(action)) {
					return false;
				}

				if (activeWindow.uiCondition) {
					const uiState = activeWindow.uiCondition(game, player);

					if (uiState === false) {
						return false;
					}

					if (role === 'witch') {
						const hasSubmittedAction = game.currentActions[player.userId];
						if (hasSubmittedAction && hasSubmittedAction.action !== 'skip') {
							return false;
						}

						if (action === 'heal' && !uiState.hasAntidote) {
							return false;
						}
						if (action === 'poison' && !uiState.hasPoison) {
							return false;
						}
					}
				}
			}

			if (role === 'guard' && action === 'protect' && target) {
				const lastProtected = player.roleState?.lastProtected;
				if (lastProtected === target) {
					return false;
				}
			}

			return true;
		}

		if (phase === 'voting') {
			if (!config.allowedActions.voting?.includes(action)) return false;

			if (game.votingRound === 2 && action === 'vote') {
				const isTiedPlayer = game.tiedPlayers.includes(player.userId);

				if (isTiedPlayer) {
					return false;
				}

				if (target && !game.tiedPlayers.includes(target)) {
					return false;
				}
			}

			return true;
		}

		return false;
	}

	@bindThis
	private async processHunterShot(game: MiWerewolfGame, targetId?: string): Promise<void> {
		const hunter = game.players.find(p => p.role === 'hunter' && !p.isAlive && !p.roleState.shotUsed);
		if (!hunter || !targetId) return;

		const target = game.players.find(p => p.userId === targetId);
		if (!target || !target.isAlive) return;

		hunter.roleState.shotUsed = true;
		target.isAlive = false;
		target.deathReason = 'shot_by_hunter';
		target.revealRole = true;

		game.logs.push({
			phase: 'hunter_shooting',
			day: game.dayNumber,
			type: 'hunter_shot',
			data: { hunterId: hunter.userId, targetId },
		});

		this.globalEventService.publishWerewolfGameStream(game.id, 'playerDied', {
			userId: targetId,
			reason: 'shot_by_hunter',
			revealRole: true,
			role: target.role ?? undefined,
			players: game.players,
		});

		await this.broadcastAndWaitTransition(game.id, 'death_announcement', 3000, {
			reason: 'shot_by_hunter',
			userId: targetId,
		});

		const winner = await this.checkWinCondition(game);
		if (winner) {
			await this.endGame(game, winner);
			return;
		}

		const previousPhase = game.logs[game.logs.length - 2]?.phase;
		if (previousPhase === 'night_end') {
			game.phase = 'day';
			game.subPhase = 'discussion';
			game.dayNumber += 1;
		} else {
			game.phase = 'night';
			game.subPhase = 'werewolf_turn';
		}

		game.phaseStartedAt = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			dayNumber: game.dayNumber,
			phaseStartedAt: game.phaseStartedAt,
			logs: game.logs,
			players: game.players,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});
	}

	@bindThis
	private async checkPhaseComplete(game: MiWerewolfGame): Promise<void> {
		if (game.phase === 'night') {
			await this.checkNightPhaseComplete(game);
		} else if (game.phase === 'voting') {
			await this.checkVotingPhaseComplete(game);
		}
	}

	@bindThis
	private async checkNightPhaseComplete(game: MiWerewolfGame): Promise<void> {
		const requiredPlayers = this.getPlayersForCurrentSubPhase(game);
		const allActionsSubmitted = requiredPlayers.every(p => game.currentActions[p.userId] != null);

		if (!allActionsSubmitted) return;

		if (game.subPhase) {
			const currentRole = game.subPhase.replace('_turn', '') as WerewolfRole;
			const roleConfig = ROLE_CONFIGS[currentRole];

			if (roleConfig?.nightActionDuration) {
				return;
			}
		}

		this.clearNightPhaseTimer(game.id);

		await this.processNightActions(game);
		await this.advanceNightSubPhase(game);
	}

	@bindThis
	private getPlayersForCurrentSubPhase(game: MiWerewolfGame): Array<any> {
		const alivePlayers = game.players.filter(p => p.isAlive);

		switch (game.subPhase) {
			case 'werewolf_turn':
				return alivePlayers.filter(p => p.role === 'werewolf');
			case 'witch_turn':
				return alivePlayers.filter(p => p.role === 'witch');
			case 'seer_turn':
				return alivePlayers.filter(p => p.role === 'seer');
			case 'hunter_turn':
				return alivePlayers.filter(p => p.role === 'hunter');
			default:
				return [];
		}
	}

	@bindThis
	private async processNightActions(game: MiWerewolfGame): Promise<void> {
		const actions = game.currentActions;

		switch (game.subPhase) {
			case 'werewolf_turn':
				await this.processWerewolfActions(game, actions);
				break;
			case 'guard_turn':
				await this.processGuardActions(game, actions);
				break;
			case 'witch_turn':
				await this.processWitchActions(game, actions);
				break;
			case 'seer_turn':
				await this.processSeerActions(game, actions);
				break;
			case 'hunter_turn':
				await this.processHunterActions(game, actions);
				break;
		}

		game.currentActions = {};
	}

	@bindThis
	private async processWerewolfActions(game: MiWerewolfGame, actions: Record<string, any>): Promise<void> {
		const votes: Record<string, number> = {};

		const werewolves = game.players.filter(p => p.role === 'werewolf' && p.isAlive);
		const werewolfIds = new Set(werewolves.map(w => w.userId));

		Object.entries(actions).forEach(([userId, action]: [string, any]) => {
			if (!werewolfIds.has(userId)) return;

			if (action.action === 'kill' && action.target) {
				votes[action.target] = (votes[action.target] || 0) + 1;
			}
		});

		if (Object.keys(votes).length === 0) return;

		const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
		const topVotes = sortedVotes[0][1];
		const tied = sortedVotes.filter(v => v[1] === topVotes);

		const targetId = tied.length > 1
			? tied[Math.floor(Math.random() * tied.length)][0]
			: tied[0][0];

		const target = game.players.find(p => p.userId === targetId);
		if (!target) return;

		game.nightKillTarget = targetId;

		game.logs.push({
			phase: 'night',
			day: game.dayNumber,
			type: 'werewolf_kill',
			data: { targetId, tied: tied.length > 1 },
		});
	}

	@bindThis
	private async processGuardActions(game: MiWerewolfGame, actions: Record<string, any>): Promise<void> {
		const guard = game.players.find(p => p.role === 'guard' && p.isAlive);
		if (!guard) return;

		const guardAction = actions[guard.userId];
		if (!guardAction) return;

		if (guardAction.action === 'protect' && guardAction.target) {
			const target = game.players.find(p => p.userId === guardAction.target);
			if (target && target.isAlive) {
				guard.roleState.lastProtected = guardAction.target;

				game.logs.push({
					phase: 'night',
					day: game.dayNumber,
					type: 'guard_protect',
					data: { guardId: guard.userId, targetId: guardAction.target },
				});
			}
		}
	}

	@bindThis
	private async processWitchActions(game: MiWerewolfGame, actions: Record<string, any>): Promise<void> {
		const witch = game.players.find(p => p.role === 'witch' && p.isAlive);
		if (!witch) return;

		const witchAction = actions[witch.userId];
		if (!witchAction) return;

		if (witchAction.action === 'heal' && game.nightKillTarget) {
			if (!witch.roleState.healUsed) {
				witch.roleState.healUsed = true;

				game.logs.push({
					phase: 'night',
					day: game.dayNumber,
					type: 'witch_heal',
					data: { witchId: witch.userId, targetId: game.nightKillTarget },
				});
			}
		} else if (witchAction.action === 'poison' && witchAction.target) {
			if (!witch.roleState.poisonUsed) {
				const target = game.players.find(p => p.userId === witchAction.target);
				if (target && target.isAlive) {
					target.isAlive = false;
					target.deathReason = 'poisoned';
					target.revealRole = false;
					witch.roleState.poisonUsed = true;

					game.logs.push({
						phase: 'night',
						day: game.dayNumber,
						type: 'witch_poison',
						data: { witchId: witch.userId, targetId: witchAction.target },
					});
				}
			}
		}
	}

	@bindThis
	private async processSeerActions(game: MiWerewolfGame, actions: Record<string, any>): Promise<void> {
		const seer = game.players.find(p => p.role === 'seer' && p.isAlive);
		if (!seer) return;

		const seerAction = actions[seer.userId];
		if (!seerAction || seerAction.action !== 'check' || !seerAction.target) return;

		const target = game.players.find(p => p.userId === seerAction.target);
		if (!target) return;

		if (!seer.roleState.checkedPlayers) {
			seer.roleState.checkedPlayers = [];
		}

		if (seer.roleState.checkedPlayers.includes(seerAction.target)) return;

		seer.roleState.checkedPlayers.push(seerAction.target);

		game.logs.push({
			phase: 'night',
			day: game.dayNumber,
			type: 'seer_check',
			data: { seerId: seer.userId, targetId: seerAction.target, result: target.team },
		});
	}

	@bindThis
	private async processHunterActions(_game: MiWerewolfGame, _actions: Record<string, any>): Promise<void> {
	}

	@bindThis
	private async advanceNightSubPhase(game: MiWerewolfGame): Promise<void> {
		const currentIndex = NIGHT_PHASE_ORDER.indexOf(game.subPhase || '');

		if (currentIndex < NIGHT_PHASE_ORDER.length - 1) {
			game.subPhase = NIGHT_PHASE_ORDER[currentIndex + 1];
			game.phaseStartedAt = new Date();

			await this.werewolfGamesRepository.update(game.id, {
				subPhase: game.subPhase,
				phaseStartedAt: game.phaseStartedAt,
				logs: game.logs,
				players: game.players,
			});
			await this.cacheGame(game);

			this.globalEventService.publishWerewolfGameStream(game.id, 'subPhaseChanged', {
				subPhase: game.subPhase,
				voicePermissions: this.getVoicePermissions(game),
			});

			this.startNightPhaseTimer(game.id);
		} else {
			await this.endNight(game);
		}
	}

	@bindThis
	private async endNight(game: MiWerewolfGame): Promise<void> {
		let hunterTriggered = false;
		const deadPlayers: Array<{ userId: string }> = [];

		const tonightLogs = game.logs.filter(log => log.day === game.dayNumber && log.phase === 'night');
		const guardProtectLog = tonightLogs.find(log => log.type === 'guard_protect');
		const witchHealLog = tonightLogs.find(log => log.type === 'witch_heal');

		const guardProtectedTarget = guardProtectLog?.data?.targetId;
		const witchHealedTarget = witchHealLog?.data?.targetId;

		if (game.nightKillTarget) {
			const target = game.players.find(p => p.userId === game.nightKillTarget);
			if (target) {
				const wasGuarded = guardProtectedTarget === game.nightKillTarget;
				const wasHealed = witchHealedTarget === game.nightKillTarget;

				if (wasGuarded && wasHealed) {
					target.isAlive = false;
					target.deathReason = 'killed_by_werewolf';
					target.revealRole = false;
					deadPlayers.push({ userId: target.userId });

					game.logs.push({
						phase: 'night_end',
						day: game.dayNumber,
						type: 'player_died',
						data: { userId: target.userId, reason: 'killed_by_werewolf', guardWitchConflict: true },
					});

					if (target.role === 'hunter' && !target.roleState.shotUsed) {
						hunterTriggered = true;
						target.revealRole = true;
					}
				} else if (wasGuarded || wasHealed) {
					game.logs.push({
						phase: 'night_end',
						day: game.dayNumber,
						type: 'player_saved',
						data: {
							userId: target.userId,
							savedBy: wasGuarded ? 'guard' : 'witch'
						},
					});
				} else {
					target.isAlive = false;
					target.deathReason = 'killed_by_werewolf';
					target.revealRole = false;
					deadPlayers.push({ userId: target.userId });

					game.logs.push({
						phase: 'night_end',
						day: game.dayNumber,
						type: 'player_died',
						data: { userId: target.userId, reason: 'killed_by_werewolf' },
					});

					if (target.role === 'hunter' && !target.roleState.shotUsed) {
						hunterTriggered = true;
						target.revealRole = true;
					}
				}
			}
		}

		const poisonedPlayers = game.players.filter(p => !p.isAlive && p.deathReason === 'poisoned');
		poisonedPlayers.forEach(p => {
			if (!deadPlayers.find(d => d.userId === p.userId)) {
				deadPlayers.push({ userId: p.userId });
			}
		});

		deadPlayers.forEach(({ userId }) => {
			this.globalEventService.publishWerewolfGameStream(game.id, 'playerDied', {
				userId,
				reason: 'died_at_night',
				revealRole: false,
				players: game.players,
			});
		});

		if (deadPlayers.length > 0) {
			await this.broadcastAndWaitTransition(game.id, 'death_announcement', 3000, {
				reason: 'died_at_night',
				count: deadPlayers.length,
			});
		}

		game.nightKillTarget = null;

		const winner = await this.checkWinCondition(game);
		if (winner) {
			await this.endGame(game, winner);
			return;
		}

		if (hunterTriggered) {
			game.phase = 'hunter_shooting';
			game.subPhase = null;
			game.phaseStartedAt = new Date();

			await this.werewolfGamesRepository.update(game.id, {
				phase: game.phase,
				subPhase: game.subPhase,
				phaseStartedAt: game.phaseStartedAt,
				logs: game.logs,
				players: game.players,
			});
			await this.cacheGame(game);

			this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
				phase: game.phase,
				dayNumber: game.dayNumber,
				voicePermissions: this.getVoicePermissions(game),
			});

			return;
		}

		if (game.dayNumber === 0 && deadPlayers.length > 0) {
			await this.startTestamentPhase(game, deadPlayers.map(p => p.userId));
			return;
		}

		game.phase = 'day';
		game.subPhase = 'discussion';
		game.dayNumber += 1;
		game.phaseStartedAt = new Date();

		if (game.dayNumber > MAX_ROUNDS) {
			game.logs.push({
				phase: 'day',
				day: game.dayNumber,
				type: 'max_rounds_reached',
				data: { maxRounds: MAX_ROUNDS },
			});

			await this.endGame(game, null);
			return;
		}

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			dayNumber: game.dayNumber,
			phaseStartedAt: game.phaseStartedAt,
			logs: game.logs,
			players: game.players,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});

		await this.startDayDiscussion(game, deadPlayers.map(p => p.userId));
	}

	@bindThis
	private async startTestamentPhase(game: MiWerewolfGame, deadUserIds: string[]): Promise<void> {
		const testamentQueue = deadUserIds.length > 1
			? [...deadUserIds].sort(() => Math.random() - 0.5)
			: deadUserIds;

		game.phase = 'testament';
		game.subPhase = null;
		game.testamentQueue = testamentQueue;
		game.currentTestamentIndex = 0;
		game.currentSpeaker = testamentQueue[0];
		game.speakerStartTime = new Date();
		game.phaseStartedAt = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			testamentQueue: game.testamentQueue,
			currentTestamentIndex: game.currentTestamentIndex,
			currentSpeaker: game.currentSpeaker,
			speakerStartTime: game.speakerStartTime,
			phaseStartedAt: game.phaseStartedAt,
			logs: game.logs,
			players: game.players,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});

		this.globalEventService.publishWerewolfGameStream(game.id, 'speakerChanged', {
			userId: testamentQueue[0],
			timeLimit: TESTAMENT_TIME_LIMIT,
			isTestament: true,
		});

		this.startSpeechTimer(game.id, TESTAMENT_TIME_LIMIT, true);
	}

	@bindThis
	private async startDayDiscussion(game: MiWerewolfGame, deadUserIds?: string[]): Promise<void> {
		const alivePlayers = game.players.filter(p => p.isAlive);

		let speechOrder: string[];

		if (deadUserIds && deadUserIds.length > 0) {
			const randomDeadUserId = deadUserIds[Math.floor(Math.random() * deadUserIds.length)];
			const deadPlayer = game.players.find(p => p.userId === randomDeadUserId);

			if (deadPlayer) {
				const sortedBySeats = [...alivePlayers].sort((a, b) => a.seat - b.seat);

				const goRight = Math.random() < 0.5;

				if (goRight) {
					const startIndex = sortedBySeats.findIndex(p => p.seat > deadPlayer.seat);
					if (startIndex !== -1) {
						speechOrder = [...sortedBySeats.slice(startIndex), ...sortedBySeats.slice(0, startIndex)].map(p => p.userId);
					} else {
						speechOrder = sortedBySeats.map(p => p.userId);
					}
				} else {
					const reversedSeats = [...sortedBySeats].reverse();
					const startIndex = reversedSeats.findIndex(p => p.seat < deadPlayer.seat);
					if (startIndex !== -1) {
						speechOrder = [...reversedSeats.slice(startIndex), ...reversedSeats.slice(0, startIndex)].map(p => p.userId);
					} else {
						speechOrder = reversedSeats.map(p => p.userId);
					}
				}
			} else {
				speechOrder = [...alivePlayers].sort(() => Math.random() - 0.5).map(p => p.userId);
			}
		} else {
			speechOrder = [...alivePlayers].sort(() => Math.random() - 0.5).map(p => p.userId);
		}

		game.speechOrder = speechOrder;
		game.currentSpeechIndex = 0;
		game.currentSpeaker = game.speechOrder[0];
		game.speakerStartTime = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			speechOrder: game.speechOrder,
			currentSpeechIndex: game.currentSpeechIndex,
			currentSpeaker: game.currentSpeaker,
			speakerStartTime: game.speakerStartTime,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'speakerChanged', {
			userId: game.currentSpeaker,
			timeLimit: SPEECH_TIME_LIMIT,
			isTestament: false,
		});

		this.startSpeechTimer(game.id, SPEECH_TIME_LIMIT, false);
	}

	@bindThis
	public async skipSpeech(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;

		if (game.phase === 'testament') {
			return await this.skipTestament(game, user);
		}

		if (game.phase !== 'day' || game.subPhase !== 'discussion') return false;

		if (user.id !== game.currentSpeaker) return false;

		game.logs.push({
			phase: 'day',
			day: game.dayNumber,
			type: 'speech_skipped',
			data: { userId: game.currentSpeaker },
		});

		await this.advanceToNextSpeaker(game);
		return true;
	}

	@bindThis
	private async skipTestament(game: MiWerewolfGame, user: MiUser): Promise<boolean> {
		if (!game.testamentQueue || game.currentTestamentIndex == null) return false;

		const currentUserId = game.testamentQueue[game.currentTestamentIndex];
		if (user.id !== currentUserId) return false;

		return await this.finishTestament(game.id, user);
	}

	@bindThis
	private async advanceToNextSpeaker(game: MiWerewolfGame): Promise<void> {
		if (!game.speechOrder || game.currentSpeechIndex == null) return;

		let nextIndex = game.currentSpeechIndex + 1;
		let nextSpeaker: string | null = null;

		while (nextIndex < game.speechOrder.length) {
			const candidateUserId = game.speechOrder[nextIndex];
			const candidatePlayer = game.players.find(p => p.userId === candidateUserId);

			if (candidatePlayer && candidatePlayer.isAlive) {
				nextSpeaker = candidateUserId;
				game.currentSpeechIndex = nextIndex;
				break;
			}

			nextIndex += 1;
		}

		if (nextSpeaker === null) {
			this.clearSpeechTimer(game.id);
			game.speechOrder = null;
			game.currentSpeechIndex = null;
			game.currentSpeaker = null;
			game.speakerStartTime = null;

			await this.werewolfGamesRepository.update(game.id, {
				speechOrder: game.speechOrder,
				currentSpeechIndex: game.currentSpeechIndex,
				currentSpeaker: game.currentSpeaker,
				speakerStartTime: game.speakerStartTime,
				logs: game.logs,
			});
			await this.cacheGame(game);

			this.globalEventService.publishWerewolfGameStream(game.id, 'discussionEnded', {});

			await this.broadcastAndWaitTransition(game.id, 'discussion_to_voting', 3000, {});

			if (game.votingRound === 2 && game.tiedPlayers.length > 0) {
				await this.startSecondRoundVoting(game.id);
			} else {
				await this.startVoting(game.id);
			}
			return;
		}

		await this.broadcastAndWaitTransition(game.id, 'speech_transition', 3000, {});

		game.currentSpeaker = nextSpeaker;
		game.speakerStartTime = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			currentSpeechIndex: game.currentSpeechIndex,
			currentSpeaker: game.currentSpeaker,
			speakerStartTime: game.speakerStartTime,
			logs: game.logs,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'speakerChanged', {
			userId: game.currentSpeaker,
			timeLimit: SPEECH_TIME_LIMIT,
			isTestament: false,
		});

		this.startSpeechTimer(game.id, SPEECH_TIME_LIMIT, false);
	}

	@bindThis
	public async finishTestament(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;
		if (game.phase !== 'testament') return false;

		if (!game.testamentQueue || game.currentTestamentIndex == null) return false;

		const currentUserId = game.testamentQueue[game.currentTestamentIndex];
		if (currentUserId !== user.id) return false;

		game.logs.push({
			phase: 'testament',
			day: game.dayNumber,
			type: 'testament_finished',
			data: { userId: user.id },
		});

		game.currentTestamentIndex += 1;

		if (game.currentTestamentIndex >= game.testamentQueue.length) {
			const lastLog = game.logs[game.logs.length - 2];
			const isSelfDestructTestament = lastLog?.type === 'self_destruct';

			game.testamentQueue = null;
			game.currentTestamentIndex = null;
			game.currentSpeaker = null;
			game.speakerStartTime = null;

			if (isSelfDestructTestament) {
				game.phase = 'night';
				game.subPhase = 'werewolf_turn';
				game.phaseStartedAt = new Date();

				await this.werewolfGamesRepository.update(game.id, {
					phase: game.phase,
					subPhase: game.subPhase,
					testamentQueue: game.testamentQueue,
					currentTestamentIndex: game.currentTestamentIndex,
					currentSpeaker: game.currentSpeaker,
					speakerStartTime: game.speakerStartTime,
					phaseStartedAt: game.phaseStartedAt,
					logs: game.logs,
				});
				await this.cacheGame(game);

				this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
					phase: game.phase,
					dayNumber: game.dayNumber,
				});
			} else {
				game.phase = 'day';
				game.subPhase = 'discussion';
				game.dayNumber += 1;
				game.phaseStartedAt = new Date();

				if (game.dayNumber > MAX_ROUNDS) {
					game.logs.push({
						phase: 'day',
						day: game.dayNumber,
						type: 'max_rounds_reached',
						data: { maxRounds: MAX_ROUNDS },
					});

					await this.endGame(game, null);
					return true;
				}

				await this.werewolfGamesRepository.update(game.id, {
					phase: game.phase,
					subPhase: game.subPhase,
					dayNumber: game.dayNumber,
					testamentQueue: game.testamentQueue,
					currentTestamentIndex: game.currentTestamentIndex,
					currentSpeaker: game.currentSpeaker,
					speakerStartTime: game.speakerStartTime,
					phaseStartedAt: game.phaseStartedAt,
					logs: game.logs,
				});
				await this.cacheGame(game);

				this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
					phase: game.phase,
					dayNumber: game.dayNumber,
				});

				await this.startDayDiscussion(game);
			}
		} else {
			game.phaseStartedAt = new Date();

			await this.werewolfGamesRepository.update(game.id, {
				currentTestamentIndex: game.currentTestamentIndex,
				phaseStartedAt: game.phaseStartedAt,
				logs: game.logs,
			});
			await this.cacheGame(game);

			this.globalEventService.publishWerewolfGameStream(game.id, 'testamentNext', {
				userId: game.testamentQueue[game.currentTestamentIndex],
			});
		}

		return true;
	}

	@bindThis
	public async selfDestruct(gameId: MiWerewolfGame['id'], user: MiUser): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;
		if (game.phase !== 'day' || game.subPhase !== 'discussion') return false;

		const player = game.players.find(p => p.userId === user.id);
		if (!player || !player.isAlive || player.role !== 'werewolf') return false;

		this.clearSpeechTimer(game.id);

		player.isAlive = false;
		player.deathReason = 'self_destructed';
		player.revealRole = true;

		game.speechOrder = null;
		game.currentSpeechIndex = null;
		game.currentSpeaker = null;
		game.speakerStartTime = null;

		game.logs.push({
			phase: 'day',
			day: game.dayNumber,
			type: 'self_destruct',
			data: { userId: user.id },
		});

		await this.werewolfGamesRepository.update(game.id, {
			logs: game.logs,
			players: game.players,
			speechOrder: game.speechOrder,
			currentSpeechIndex: game.currentSpeechIndex,
			currentSpeaker: game.currentSpeaker,
			speakerStartTime: game.speakerStartTime,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'discussionEnded', {});

		this.globalEventService.publishWerewolfGameStream(game.id, 'playerDied', {
			userId: user.id,
			reason: 'self_destructed',
			revealRole: true,
			role: player.role ?? undefined,
			players: game.players,
		});

		await this.broadcastAndWaitTransition(game.id, 'death_announcement', 3000, {
			reason: 'self_destructed',
			userId: user.id,
		});

		const winner = await this.checkWinCondition(game);
		if (winner) {
			await this.endGame(game, winner);
			return true;
		}

		await this.startTestamentPhase(game, [user.id]);

		return true;
	}

	@bindThis
	public async startVoting(gameId: MiWerewolfGame['id']): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;
		if (game.phase !== 'day' || game.subPhase !== 'discussion') return false;

		game.phase = 'voting';
		game.subPhase = null;
		game.phaseStartedAt = new Date();
		game.currentActions = {};
		game.votingRound = 1;
		game.tiedPlayers = [];

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			phaseStartedAt: game.phaseStartedAt,
			currentActions: game.currentActions,
			votingRound: game.votingRound,
			tiedPlayers: game.tiedPlayers,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});

		this.startVotingTimer(gameId);

		return true;
	}

	@bindThis
	private async startSecondRoundVoting(gameId: MiWerewolfGame['id']): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || !game.isStarted || game.isEnded) return false;
		if (game.phase !== 'day' || game.subPhase !== 'discussion') return false;

		game.phase = 'voting';
		game.subPhase = null;
		game.phaseStartedAt = new Date();
		game.currentActions = {};

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			phaseStartedAt: game.phaseStartedAt,
			currentActions: game.currentActions,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});

		this.startVotingTimer(gameId);

		return true;
	}

	@bindThis
	private async checkVotingPhaseComplete(game: MiWerewolfGame): Promise<void> {
		const alivePlayers = game.players.filter(p => p.isAlive);
		const allVoted = alivePlayers.every(p => game.currentActions[p.userId] != null);

		if (!allVoted) return;

		await this.processVoting(game);
	}

	@bindThis
	private async processVoting(game: MiWerewolfGame): Promise<void> {
		const votes: Record<string, number> = {};

		const alivePlayers = game.players.filter(p => p.isAlive);
		const alivePlayerIds = new Set(alivePlayers.map(p => p.userId));

		Object.entries(game.currentActions).forEach(([userId, action]: [string, any]) => {
			if (!alivePlayerIds.has(userId)) return;

			if (action.action === 'vote' && action.target) {
				votes[action.target] = (votes[action.target] || 0) + 1;
			}
		});

		game.currentActions = {};

		if (Object.keys(votes).length === 0) {
			await this.endDay(game, null);
			return;
		}

		const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
		const topVotes = sortedVotes[0][1];
		const tied = sortedVotes.filter(v => v[1] === topVotes);

		if (tied.length > 1) {
			if (game.votingRound === 1) {
				game.tiedPlayers = tied.map(v => v[0]);
				game.votingRound = 2;

				game.logs.push({
					phase: 'voting',
					day: game.dayNumber,
					type: 'vote_tied_round1',
					data: { votes, tiedPlayers: game.tiedPlayers },
				});

				await this.werewolfGamesRepository.update(game.id, {
					tiedPlayers: game.tiedPlayers,
					votingRound: game.votingRound,
					logs: game.logs,
					currentActions: game.currentActions,
				});
				await this.cacheGame(game);

				this.globalEventService.publishWerewolfGameStream(game.id, 'votingTied', {
					round: 1,
					tiedPlayers: game.tiedPlayers,
				});

				await this.broadcastAndWaitTransition(game.id, 'voting_results', 5000, {
					result: 'tied_round1',
					tiedPlayers: game.tiedPlayers,
				});

				await this.startSecondRoundDiscussion(game);
				return;
			} else {
				game.logs.push({
					phase: 'voting',
					day: game.dayNumber,
					type: 'vote_tied_round2',
					data: { votes, tiedPlayers: tied.map(v => v[0]) },
				});

				await this.werewolfGamesRepository.update(game.id, {
					logs: game.logs,
					currentActions: game.currentActions,
				});
				await this.cacheGame(game);

				this.globalEventService.publishWerewolfGameStream(game.id, 'votingTied', {
					round: 2,
					tiedPlayers: tied.map(v => v[0]),
				});

				await this.broadcastAndWaitTransition(game.id, 'voting_results', 5000, {
					result: 'tied_round2',
					tiedPlayers: tied.map(v => v[0]),
				});

				await this.endDay(game, null);
				return;
			}
		}

		const eliminatedId = tied[0][0];
		const eliminated = game.players.find(p => p.userId === eliminatedId);
		if (!eliminated) {
			await this.endDay(game, null);
			return;
		}

		eliminated.isAlive = false;
		eliminated.deathReason = 'voted_out';
		eliminated.revealRole = false;

		game.logs.push({
			phase: 'voting',
			day: game.dayNumber,
			type: 'player_eliminated',
			data: { userId: eliminatedId, votes: votes[eliminatedId], role: eliminated.role, round: game.votingRound },
		});

		this.globalEventService.publishWerewolfGameStream(game.id, 'playerDied', {
			userId: eliminatedId,
			reason: 'voted_out',
			revealRole: false,
			role: eliminated.role ?? undefined,
			players: game.players,
		});

		await this.broadcastAndWaitTransition(game.id, 'death_announcement', 3000, {
			reason: 'voted_out',
			userId: eliminatedId,
		});

		if (eliminated.role === 'hunter' && !eliminated.roleState.shotUsed) {
			game.phase = 'hunter_shooting';
			game.subPhase = null;
			game.phaseStartedAt = new Date();

			await this.werewolfGamesRepository.update(game.id, {
				phase: game.phase,
				subPhase: game.subPhase,
				phaseStartedAt: game.phaseStartedAt,
				logs: game.logs,
				players: game.players,
			});
			await this.cacheGame(game);

			this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
				phase: game.phase,
				dayNumber: game.dayNumber,
				voicePermissions: this.getVoicePermissions(game),
			});

			return;
		}

		await this.endDay(game, eliminatedId);
	}

	@bindThis
	private async startSecondRoundDiscussion(game: MiWerewolfGame): Promise<void> {
		const aliveTiedPlayers = game.tiedPlayers
			.map(userId => game.players.find(p => p.userId === userId))
			.filter(p => p && p.isAlive);

		if (aliveTiedPlayers.length === 0) {
			await this.endDay(game, null);
			return;
		}

		const shuffledTiedPlayers = [...aliveTiedPlayers].sort(() => Math.random() - 0.5);
		game.speechOrder = shuffledTiedPlayers.map(p => p!.userId);
		game.currentSpeechIndex = 0;
		game.currentSpeaker = game.speechOrder[0];
		game.speakerStartTime = new Date();

		game.phase = 'day';
		game.subPhase = 'discussion';
		game.phaseStartedAt = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			phaseStartedAt: game.phaseStartedAt,
			speechOrder: game.speechOrder,
			currentSpeechIndex: game.currentSpeechIndex,
			currentSpeaker: game.currentSpeaker,
			speakerStartTime: game.speakerStartTime,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'secondRoundDiscussionStarted', {
			tiedPlayers: game.tiedPlayers,
			speechOrder: game.speechOrder,
		});

		this.globalEventService.publishWerewolfGameStream(game.id, 'speakerChanged', {
			userId: game.currentSpeaker,
			timeLimit: SPEECH_TIME_LIMIT,
			isTestament: false,
		});

		this.startSpeechTimer(game.id, SPEECH_TIME_LIMIT, false);
	}

	@bindThis
	private async endDay(game: MiWerewolfGame, _eliminatedId: string | null): Promise<void> {
		const winner = await this.checkWinCondition(game);
		if (winner) {
			await this.endGame(game, winner);
			return;
		}

		game.phase = 'night';
		game.subPhase = 'werewolf_turn';
		game.phaseStartedAt = new Date();

		game.tiedPlayers = [];
		game.votingRound = 1;

		await this.werewolfGamesRepository.update(game.id, {
			phase: game.phase,
			subPhase: game.subPhase,
			phaseStartedAt: game.phaseStartedAt,
			logs: game.logs,
			players: game.players,
			tiedPlayers: game.tiedPlayers,
			votingRound: game.votingRound,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'phaseChanged', {
			phase: game.phase,
			dayNumber: game.dayNumber,
			voicePermissions: this.getVoicePermissions(game),
		});

		this.startNightPhaseTimer(game.id);
	}

	@bindThis
	private async checkWinCondition(game: MiWerewolfGame): Promise<WerewolfTeam | null> {
		const alivePlayers = game.players.filter(p => p.isAlive);
		const aliveWerewolves = alivePlayers.filter(p => p.team === 'werewolf');
		const aliveVillagers = alivePlayers.filter(p => p.team === 'villager');

		const aliveGods = aliveVillagers.filter(p => p.role !== 'villager');
		const aliveOrdinaryVillagers = aliveVillagers.filter(p => p.role === 'villager');

		if (aliveWerewolves.length === 0) {
			return 'villager';
		}

		if (game.config.rules.gameMode === 'slaughter_all_sides') {
			if (aliveGods.length === 0 || aliveOrdinaryVillagers.length === 0) {
				return 'werewolf';
			}
		}

		return null;
	}

	@bindThis
	private async endGame(game: MiWerewolfGame, winner: WerewolfTeam | null): Promise<void> {
		game.isEnded = true;
		game.endedAt = new Date();
		game.winnerTeam = winner;
		game.phase = 'ended';

		if (game.config.voiceEnabled) {
			await this.werewolfVoiceService.cleanupVoiceSession(game.id);
		}

		await this.werewolfGamesRepository.update(game.id, {
			isEnded: true,
			endedAt: game.endedAt,
			winnerTeam: winner,
			phase: 'ended',
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'gameEnded', {
			winnerTeam: winner,
			game: await this.werewolfGameEntityService.packDetail(game),
		});
	}

	@bindThis
	public async sendMessage(gameId: MiWerewolfGame['id'], user: MiUser, message: string, channelType: 'game' | 'dead'): Promise<boolean> {
		const game = await this.get(gameId);
		if (!game || game.isEnded) return false;

		const player = game.players.find(p => p.userId === user.id);
		if (!player) return false;

		if (game.phase === 'waiting' && !game.isStarted) {
			if (channelType !== 'game') return false;

			this.globalEventService.publishWerewolfGameStream(game.id, 'message', {
				channel: 'lobby',
				userId: user.id,
				message,
				timestamp: new Date(),
			});
			return true;
		}

		if (!game.isStarted) return false;

		if (channelType === 'dead') {
			if (player.isAlive) return false;

			this.broadcastToDeadPlayers(game, {
				userId: user.id,
				message,
				timestamp: new Date(),
			});
			return true;
		}

		if (!player.isAlive) return false;

		if (game.phase === 'night') {
			if (game.subPhase === 'werewolf_turn' && player.role === 'werewolf') {
				this.broadcastToWerewolves(game, {
					userId: user.id,
					message,
					timestamp: new Date(),
				});
				return true;
			}
			return false;
		}

		if (game.phase === 'day' || game.phase === 'voting' || game.phase === 'testament') {
			this.broadcastToAllPlayers(game, {
				userId: user.id,
				message,
				timestamp: new Date(),
			});
			return true;
		}

		return false;
	}

	@bindThis
	private broadcastToAllPlayers(game: MiWerewolfGame, messageData: any): void {
		const alivePlayers = game.players.filter(p => p.isAlive).map(p => p.userId);
		const deadPlayers = game.players.filter(p => !p.isAlive).map(p => p.userId);
		const recipients = [...alivePlayers, ...deadPlayers];

		recipients.forEach(_userId => {
			this.globalEventService.publishWerewolfGameStream(game.id, 'message', {
				channel: 'game',
				...messageData,
			});
		});
	}

	@bindThis
	private broadcastToWerewolves(game: MiWerewolfGame, messageData: any): void {
		const aliveWerewolves = game.players.filter(p => p.isAlive && p.role === 'werewolf').map(p => p.userId);
		const deadWerewolves = game.players.filter(p => !p.isAlive && p.role === 'werewolf').map(p => p.userId);
		const recipients = [...aliveWerewolves, ...deadWerewolves];

		recipients.forEach(_userId => {
			this.globalEventService.publishWerewolfGameStream(game.id, 'message', {
				channel: 'werewolf',
				...messageData,
			});
		});
	}

	@bindThis
	private broadcastToDeadPlayers(game: MiWerewolfGame, messageData: any): void {
		const deadPlayers = game.players.filter(p => !p.isAlive).map(p => p.userId);

		deadPlayers.forEach(_userId => {
			this.globalEventService.publishWerewolfGameStream(game.id, 'message', {
				channel: 'dead',
				...messageData,
			});
		});
	}

	@bindThis
	private async broadcastAndWaitTransition(
		gameId: string,
		delayType: 'death_announcement' | 'speech_transition' | 'discussion_to_voting' | 'voting_results',
		durationMs: number,
		context?: Record<string, any>,
	): Promise<void> {
		this.globalEventService.publishWerewolfGameStream(gameId, 'transitionDelay', {
			type: delayType,
			duration: durationMs,
			...context,
		});

		await new Promise(resolve => setTimeout(resolve, durationMs));
	}

	@bindThis
	private startSpeechTimer(gameId: string, timeLimit: number, isTestament: boolean): void {
		this.clearSpeechTimer(gameId);

		const checkInterval = setInterval(async () => {
			const game = await this.get(gameId);
			if (!game || !game.isStarted || game.isEnded) {
				this.clearSpeechTimer(gameId);
				return;
			}

			if (!game.speakerStartTime) {
				this.clearSpeechTimer(gameId);
				return;
			}

			const elapsed = Math.floor((Date.now() - game.speakerStartTime.getTime()) / 1000);
			const remaining = Math.max(0, timeLimit - elapsed);

			if (remaining === 0) {
				this.clearSpeechTimer(gameId);
				if (game.hostId) {
					const host = { id: game.hostId } as any;
					if (isTestament && game.phase === 'testament') {
						await this.skipTestament(game, host);
					} else if (game.phase === 'day' && game.subPhase === 'discussion') {
						await this.advanceToNextSpeaker(game);
					}
				}
				return;
			}

			this.globalEventService.publishWerewolfGameStream(gameId, 'speechTimeUpdate', {
				remaining,
			});
		}, 1000);

		this.speechTimers.set(gameId, checkInterval);
	}

	@bindThis
	private clearSpeechTimer(gameId: string): void {
		const timer = this.speechTimers.get(gameId);
		if (timer) {
			clearInterval(timer);
			this.speechTimers.delete(gameId);
		}
	}

	@bindThis
	public async setReady(gameId: MiWerewolfGame['id'], user: MiUser): Promise<void> {
		const game = await this.get(gameId);
		if (!game || game.isStarted || game.isEnded) return;

		if (!game.readyPlayers.includes(user.id)) {
			game.readyPlayers.push(user.id);
		}

		const kickTimerKey = `${gameId}:${user.id}`;
		const kickTimer = this.readyKickTimers.get(kickTimerKey);
		if (kickTimer) {
			clearTimeout(kickTimer);
			this.readyKickTimers.delete(kickTimerKey);
		}

		await this.werewolfGamesRepository.update(game.id, {
			readyPlayers: game.readyPlayers,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'playerReady', {
			userId: user.id,
			readyPlayers: game.readyPlayers,
		});

		if (game.readyPlayers.length === game.players.length && game.players.length === game.config.maxPlayers) {
			await this.startCountdown(game);
		}
	}

	@bindThis
	public async setUnready(gameId: MiWerewolfGame['id'], user: MiUser): Promise<void> {
		const game = await this.get(gameId);
		if (!game || game.isStarted || game.isEnded) return;

		game.readyPlayers = game.readyPlayers.filter(id => id !== user.id);

		if (game.isCountingDown) {
			this.clearCountdown(game.id);
			game.isCountingDown = false;
			game.countdownStartedAt = null;
		}

		await this.werewolfGamesRepository.update(game.id, {
			readyPlayers: game.readyPlayers,
			isCountingDown: game.isCountingDown,
			countdownStartedAt: game.countdownStartedAt,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'playerUnready', {
			userId: user.id,
			readyPlayers: game.readyPlayers,
		});
	}

	@bindThis
	private async startCountdown(game: MiWerewolfGame): Promise<void> {
		if (game.isCountingDown) return;

		game.isCountingDown = true;
		game.countdownStartedAt = new Date();

		await this.werewolfGamesRepository.update(game.id, {
			isCountingDown: game.isCountingDown,
			countdownStartedAt: game.countdownStartedAt,
		});
		await this.cacheGame(game);

		this.globalEventService.publishWerewolfGameStream(game.id, 'countdownStarted', {
			countdownStartedAt: game.countdownStartedAt,
		});

		this.clearReadyKickTimersForGame(game.id);

		const countdownTimer = setTimeout(async () => {
			this.countdownTimers.delete(game.id);
			const updatedGame = await this.get(game.id);
			if (updatedGame && !updatedGame.isStarted && updatedGame.isCountingDown) {
				await this.autoStartGame(updatedGame);
			}
		}, 3000);

		this.countdownTimers.set(game.id, countdownTimer);

		for (let i = 3; i > 0; i--) {
			setTimeout(() => {
				this.globalEventService.publishWerewolfGameStream(game.id, 'countdownTick', {
					remaining: i,
				});
			}, (3 - i) * 1000);
		}
	}

	@bindThis
	private clearCountdown(gameId: string): void {
		const timer = this.countdownTimers.get(gameId);
		if (timer) {
			clearTimeout(timer);
			this.countdownTimers.delete(gameId);
		}

		this.globalEventService.publishWerewolfGameStream(gameId, 'countdownCancelled', {});
	}

	@bindThis
	private clearReadyKickTimersForGame(gameId: string): void {
		const keysToDelete: string[] = [];
		this.readyKickTimers.forEach((timer, key) => {
			if (key.startsWith(`${gameId}:`)) {
				clearTimeout(timer);
				keysToDelete.push(key);
			}
		});
		keysToDelete.forEach(key => this.readyKickTimers.delete(key));
	}

	@bindThis
	private async startReadyKickTimer(gameId: string, userId: string): Promise<void> {
		const kickTimerKey = `${gameId}:${userId}`;

		const existingTimer = this.readyKickTimers.get(kickTimerKey);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const kickTimer = setTimeout(async () => {
			this.readyKickTimers.delete(kickTimerKey);

			const game = await this.get(gameId);
			if (!game || game.isStarted || game.isEnded) return;

			const occupiedSeats = game.seats.filter(s => !s.locked && s.userId != null).length;
			if (occupiedSeats === game.config.maxPlayers && !game.readyPlayers.includes(userId)) {
				const seatIndex = game.seats.findIndex(s => s.userId === userId);
				if (seatIndex !== -1) {
					game.seats[seatIndex].userId = null;
				}

				const playerIndex = game.players.findIndex(p => p.userId === userId);
				if (playerIndex !== -1) {
					game.players.splice(playerIndex, 1);
				}

				game.readyPlayers = game.readyPlayers.filter(id => id !== userId);

				await this.werewolfGamesRepository.update(game.id, {
					seats: game.seats,
					players: game.players,
					readyPlayers: game.readyPlayers,
				});
				await this.cacheGame(game);

				this.globalEventService.publishWerewolfGameStream(game.id, 'playerKicked', {
					userId,
					reason: 'ready_timeout',
				});

				this.globalEventService.publishWerewolfGameStream(game.id, 'seatChanged', {
					seats: game.seats,
					players: game.players,
					userId,
					seatNumber: null,
				});
			}
		}, 30000);

		this.readyKickTimers.set(kickTimerKey, kickTimer);
	}

	@bindThis
	private getVoicePermissions(game: MiWerewolfGame): Record<string, boolean> {
		const permissions: Record<string, boolean> = {};

		if (!game.isStarted) {
			for (const seat of game.seats) {
				if (seat.userId) {
					permissions[seat.userId] = true;
				}
			}
			return permissions;
		}

		for (const player of game.players) {
			permissions[player.userId] = this.canPlayerSpeakNow(game, player.userId);
		}

		return permissions;
	}

	@bindThis
	public canPlayerSpeakNow(game: MiWerewolfGame, userId: MiUser['id']): boolean {
		if (game.phase === 'waiting') {
			return game.seats.some(s => s.userId === userId);
		}

		if (!game.isStarted || game.isEnded) return false;

		const player = game.players.find(p => p.userId === userId);
		if (!player) return false;

		if (!player.isAlive && game.phase !== 'testament') return false;

		if (game.phase === 'night' && game.subPhase) {
			const activeRole = game.subPhase.replace('_turn', '') as WerewolfRole;
			return player.role === activeRole;
		}

		if (game.phase === 'day' && game.subPhase === 'discussion') {
			return game.currentSpeaker === userId;
		}

		if (game.phase === 'testament') {
			return game.currentSpeaker === userId;
		}

		return false;
	}

	@bindThis
	public canPlayerHearNow(game: MiWerewolfGame, listenerId: MiUser['id'], speakerId: MiUser['id']): boolean {
		if (game.phase === 'waiting') {
			const listenerSeated = game.seats.some(s => s.userId === listenerId);
			const speakerSeated = game.seats.some(s => s.userId === speakerId);
			return listenerSeated && speakerSeated;
		}

		if (!game.isStarted || game.isEnded) return false;

		const listener = game.players.find(p => p.userId === listenerId);
		const speaker = game.players.find(p => p.userId === speakerId);
		if (!listener || !speaker) return false;

		if (!listener.isAlive && game.phase !== 'testament') return false;

		if (!this.canPlayerSpeakNow(game, speakerId)) return false;

		if (game.phase === 'night' && game.subPhase === 'werewolf_turn') {
			return listener.role === 'werewolf' && speaker.role === 'werewolf';
		}

		if (game.phase === 'day' && game.subPhase === 'discussion') {
			return listener.isAlive && speaker.isAlive;
		}

		if (game.phase === 'testament') {
			return game.currentSpeaker === speakerId;
		}

		return false;
	}

	@bindThis
	private startNightPhaseTimer(gameId: string): void {
		this.clearNightPhaseTimer(gameId);

		const checkInterval = setInterval(async () => {
			const game = await this.get(gameId);
			if (!game || !game.isStarted || game.isEnded || game.phase !== 'night') {
				this.clearNightPhaseTimer(gameId);
				return;
			}

			if (!game.phaseStartedAt || !game.subPhase) {
				this.clearNightPhaseTimer(gameId);
				return;
			}

			const currentRole = game.subPhase.replace('_turn', '') as WerewolfRole;
			const roleConfig = ROLE_CONFIGS[currentRole];
			const duration = roleConfig?.nightActionDuration ?? NIGHT_ACTION_TIME_LIMIT;
			const now = Date.now();
			const phaseStartTime = game.phaseStartedAt.getTime();
			const elapsed = Math.floor((now - phaseStartTime) / 1000);
			const remaining = Math.max(0, duration - elapsed);

			this.globalEventService.publishWerewolfGameStream(gameId, 'nightPhaseTimeUpdate', {
				role: currentRole,
				subPhase: game.subPhase,
				elapsed,
				remaining,
				total: duration,
			});

			if (roleConfig?.timeWindows) {
				const rolePlayer = game.players.find(p => p.role === currentRole && p.isAlive);
				if (rolePlayer) {
					const timeWindowState = this.computeRoleTimeWindowState(game, rolePlayer, roleConfig, elapsed);
					if (timeWindowState) {
						this.globalEventService.publishWerewolfGameStream(gameId, 'witchTimeWindowUpdate', {
							...timeWindowState,
						});
					}
				}
			}

			if (remaining === 0) {
				this.clearNightPhaseTimer(gameId);

				const requiredPlayers = this.getPlayersForCurrentSubPhase(game);
				for (const player of requiredPlayers) {
					if (!game.currentActions[player.userId]) {
						game.currentActions[player.userId] = { action: 'skip', target: undefined };
					}
				}

				await this.processNightActions(game);
				await this.advanceNightSubPhase(game);
			}
		}, 1000);

		this.nightPhaseTimers.set(gameId, checkInterval);
	}

	@bindThis
	private clearNightPhaseTimer(gameId: string): void {
		const timer = this.nightPhaseTimers.get(gameId);
		if (timer) {
			clearInterval(timer);
			this.nightPhaseTimers.delete(gameId);
		}
	}

	@bindThis
	private startVotingTimer(gameId: string): void {
		this.clearVotingTimer(gameId);

		const checkInterval = setInterval(async () => {
			const game = await this.get(gameId);
			if (!game || !game.isStarted || game.isEnded || game.phase !== 'voting') {
				this.clearVotingTimer(gameId);
				return;
			}

			if (!game.phaseStartedAt) {
				this.clearVotingTimer(gameId);
				return;
			}

			const now = Date.now();
			const phaseStartTime = game.phaseStartedAt.getTime();
			const elapsed = Math.floor((now - phaseStartTime) / 1000);
			const remaining = Math.max(0, VOTING_TIME_LIMIT - elapsed);

			this.globalEventService.publishWerewolfGameStream(gameId, 'votingTimeUpdate', {
				elapsed,
				remaining,
				total: VOTING_TIME_LIMIT,
				round: game.votingRound,
			});

			if (remaining === 0) {
				this.clearVotingTimer(gameId);

				const alivePlayers = game.players.filter(p => p.isAlive);
				for (const player of alivePlayers) {
					if (!game.currentActions[player.userId]) {
						game.currentActions[player.userId] = { action: 'skip', target: undefined };
					}
				}

				await this.processVoting(game);
			}
		}, 1000);

		this.votingTimers.set(gameId, checkInterval);
	}

	@bindThis
	private clearVotingTimer(gameId: string): void {
		const timer = this.votingTimers.get(gameId);
		if (timer) {
			clearInterval(timer);
			this.votingTimers.delete(gameId);
		}
	}

	@bindThis
	public dispose(): void {
		this.speechTimers.forEach((timer) => clearInterval(timer));
		this.speechTimers.clear();

		this.countdownTimers.forEach((timer) => clearTimeout(timer));
		this.countdownTimers.clear();

		this.readyKickTimers.forEach((timer) => clearTimeout(timer));
		this.readyKickTimers.clear();

		this.nightPhaseTimers.forEach((timer) => clearInterval(timer));
		this.nightPhaseTimers.clear();

		this.votingTimers.forEach((timer) => clearInterval(timer));
		this.votingTimers.clear();

		this.hunterShootingTimers.forEach((timer) => clearInterval(timer));
		this.hunterShootingTimers.clear();
	}

	@bindThis
	public onApplicationShutdown(_signal?: string | undefined): void {
		this.dispose();
	}
}
