/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

export type WerewolfGameMode = 'preset_6' | 'preset_9' | 'custom';
export type WerewolfGamePhase = 'waiting' | 'night' | 'night_end' | 'day' | 'voting' | 'testament' | 'hunter_shooting' | 'ended';
export type WerewolfRole = 'seer' | 'witch' | 'hunter' | 'villager' | 'werewolf' | 'guard' | 'idiot';
export type WerewolfTeam = 'werewolf' | 'villager' | 'third_party';
export type WerewolfPlayingCardMode = 'open' | 'closed';

export interface WerewolfGameConfig {
	mode: WerewolfGameMode;
	maxPlayers: number;
	roles: WerewolfRole[];
	rules: {
		gameMode: 'slaughter_all_sides';
		playingCardMode: WerewolfPlayingCardMode;
		witchSelfHealFirstNight: boolean;
		hunterCanShootWhenPoisoned: boolean;
		dayDiscussionTime: number;
		votingTime: number;
	};
	voiceEnabled: boolean;
	chatEnabled: boolean;
}

export interface WerewolfSeat {
	seatNumber: number;
	userId: string | null;
	locked: boolean;
}

export interface WerewolfPlayer {
	userId: string;
	seat: number;
	role: WerewolfRole | null;
	team: WerewolfTeam | null;
	isAlive: boolean;
	roleState: Record<string, any>;
	deathReason?: string;
	revealRole?: boolean;
	lastWordsUsed?: boolean;
}

export interface WerewolfGameLog {
	timestamp?: Date;
	seq?: number;
	day: number;
	phase: WerewolfGamePhase;
	subPhase?: string;
	actor?: string;
	actionType?: 'join' | 'ready' | 'start' | 'roleAssigned' | 'phaseChange' | 'vote' | 'kill' | 'check' | 'poison' | 'heal' | 'protect' | 'shoot' | 'speak' | 'death' | 'gameEnd';
	target?: string;
	data?: any;
	visible?: 'all' | 'none' | string[];
	type?: string;
}

@Entity('werewolf_game')
export class MiWerewolfGame {
	@PrimaryColumn(id())
	public id: string;

	@CreateDateColumn()
	public createdAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public startedAt: Date | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public endedAt: Date | null;

	@Index()
	@Column(id())
	public hostId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public host: MiUser | null;

	@Column('boolean', {
		default: false,
	})
	public isStarted: boolean;

	@Column('boolean', {
		default: false,
	})
	public isEnded: boolean;

	@Column('jsonb')
	public config: WerewolfGameConfig;

	@Column('varchar', {
		length: 16,
		default: 'waiting',
	})
	public phase: WerewolfGamePhase;

	@Column('varchar', {
		length: 32,
		nullable: true,
	})
	public subPhase: string | null;

	@Column('integer', {
		default: 0,
	})
	public dayNumber: number;

	@Column('jsonb', {
		default: [],
	})
	public players: WerewolfPlayer[];

	@Column({
		...id(),
		nullable: true,
	})
	public winnerTeam: WerewolfTeam | null;

	@Column('jsonb', {
		default: [],
	})
	public logs: WerewolfGameLog[];

	@Column('jsonb', {
		default: {},
	})
	public currentActions: Record<string, { action: string; target?: string }>;

	@Column('varchar', {
		length: 64,
		nullable: true,
	})
	public voiceAppId: string | null;

	@Column('varchar', {
		length: 128,
		nullable: true,
	})
	public voiceAppSecret: string | null;

	@Column('jsonb', {
		default: {},
	})
	public playerVoiceSessions: Record<string, string>;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public phaseStartedAt: Date | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public phaseEndsAt: Date | null;

	@Column({
		...id(),
		nullable: true,
	})
	public currentSpeaker: string | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public speakerStartTime: Date | null;

	@Column('jsonb', {
		nullable: true,
	})
	public speechOrder: string[] | null;

	@Column('integer', {
		nullable: true,
	})
	public currentSpeechIndex: number | null;

	@Column({
		...id(),
		nullable: true,
	})
	public nightKillTarget: string | null;

	@Column('jsonb', {
		nullable: true,
	})
	public testamentQueue: string[] | null;

	@Column('integer', {
		nullable: true,
	})
	public currentTestamentIndex: number | null;

	@Column('jsonb', {
		default: [],
	})
	public seats: WerewolfSeat[];

	@Column('integer', {
		nullable: true,
	})
	public speechTimeRemaining: number | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public speechTimeoutAt: Date | null;

	@Column('jsonb', {
		default: [],
	})
	public readyPlayers: string[];

	@Column('boolean', {
		default: false,
	})
	public isCountingDown: boolean;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public countdownStartedAt: Date | null;

	@Column('jsonb', {
		default: [],
	})
	public tiedPlayers: string[];

	@Column('integer', {
		default: 1,
	})
	public votingRound: number;
}
