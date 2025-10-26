/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { WerewolfRole, WerewolfTeam } from '@/models/WerewolfGame.js';

export interface RoleSkill {
	id: string;
	type: 'night' | 'day' | 'passive' | 'death';
	targetType: 'single' | 'multiple' | 'none';
	targetRestrictions?: {
		excludeSelf?: boolean;
		onlyAlive?: boolean;
		onlyRole?: WerewolfRole[];
		onlyTeam?: WerewolfTeam[];
	};
	usageLimit?: {
		total?: number;
		perNight?: number;
		perDay?: number;
		firstNightOnly?: boolean;
	};
	priority: number;
}

export interface RoleDefinition {
	role: WerewolfRole;
	team: WerewolfTeam;
	isGod: boolean;
	displayName: string;
	description: string;
	skills: RoleSkill[];
	nightActionOrder: number;
	canVote: boolean;
	revealOnDeath: boolean;
	initialState: Record<string, any>;
}

export const ROLE_DEFINITIONS: Record<WerewolfRole, RoleDefinition> = {
	werewolf: {
		role: 'werewolf',
		team: 'werewolf',
		isGod: false,
		displayName: 'Werewolf',
		description: 'Kill one villager each night',
		skills: [
			{
				id: 'werewolf_kill',
				type: 'night',
				targetType: 'single',
				targetRestrictions: {
					excludeSelf: true,
					onlyAlive: true,
					onlyTeam: ['villager'],
				},
				priority: 100,
			},
		],
		nightActionOrder: 1,
		canVote: true,
		revealOnDeath: false,
		initialState: {},
	},

	seer: {
		role: 'seer',
		team: 'villager',
		isGod: true,
		displayName: 'Seer',
		description: 'Check one player each night, cannot check same player twice, only see team not role',
		skills: [
			{
				id: 'seer_check',
				type: 'night',
				targetType: 'single',
				targetRestrictions: {
					excludeSelf: true,
					onlyAlive: true,
				},
				priority: 300,
			},
		],
		nightActionOrder: 3,
		canVote: true,
		revealOnDeath: false,
		initialState: {
			checkedPlayers: [],
		},
	},

	witch: {
		role: 'witch',
		team: 'villager',
		isGod: true,
		displayName: 'Witch',
		description: 'Can save or poison once per game, can only use one potion per night',
		skills: [
			{
				id: 'witch_heal',
				type: 'night',
				targetType: 'single',
				targetRestrictions: {
					onlyAlive: false,
				},
				usageLimit: {
					total: 1,
					perNight: 1,
				},
				priority: 200,
			},
			{
				id: 'witch_poison',
				type: 'night',
				targetType: 'single',
				targetRestrictions: {
					excludeSelf: true,
					onlyAlive: true,
				},
				usageLimit: {
					total: 1,
					perNight: 1,
				},
				priority: 210,
			},
		],
		nightActionOrder: 2,
		canVote: true,
		revealOnDeath: false,
		initialState: {
			healUsed: false,
			poisonUsed: false,
			canSelfHeal: true,
			canSeeKillTarget: true,
		},
	},

	hunter: {
		role: 'hunter',
		team: 'villager',
		isGod: true,
		displayName: 'Hunter',
		description: 'Can shoot when dying',
		skills: [
			{
				id: 'hunter_shoot',
				type: 'death',
				targetType: 'single',
				targetRestrictions: {
					excludeSelf: true,
					onlyAlive: true,
				},
				usageLimit: {
					total: 1,
				},
				priority: 1000,
			},
		],
		nightActionOrder: 999,
		canVote: true,
		revealOnDeath: true,
		initialState: {
			shotUsed: false,
			canShootWhenPoisoned: true,
		},
	},

	guard: {
		role: 'guard',
		team: 'villager',
		isGod: true,
		displayName: 'Guard',
		description: 'Protect one player each night',
		skills: [
			{
				id: 'guard_protect',
				type: 'night',
				targetType: 'single',
				targetRestrictions: {
					onlyAlive: true,
				},
				priority: 50,
			},
		],
		nightActionOrder: 0,
		canVote: true,
		revealOnDeath: false,
		initialState: {
			lastProtected: null,
		},
	},

	idiot: {
		role: 'idiot',
		team: 'villager',
		isGod: true,
		displayName: 'Idiot',
		description: 'Cannot be voted out, but loses voting right after reveal',
		skills: [
			{
				id: 'idiot_passive',
				type: 'passive',
				targetType: 'none',
				priority: 0,
			},
		],
		nightActionOrder: 999,
		canVote: true,
		revealOnDeath: false,
		initialState: {
			isRevealed: false,
		},
	},

	villager: {
		role: 'villager',
		team: 'villager',
		isGod: false,
		displayName: 'Villager',
		description: 'Ordinary villager with no special ability',
		skills: [],
		nightActionOrder: 999,
		canVote: true,
		revealOnDeath: false,
		initialState: {},
	},
};

export function getRoleDefinition(role: WerewolfRole): RoleDefinition {
	return ROLE_DEFINITIONS[role];
}

export function getRoleSkills(role: WerewolfRole): RoleSkill[] {
	return ROLE_DEFINITIONS[role].skills;
}

export function getNightActionOrder(): WerewolfRole[] {
	return Object.values(ROLE_DEFINITIONS)
		.sort((a, b) => a.nightActionOrder - b.nightActionOrder)
		.map(def => def.role);
}

export function canUseSkill(
	skill: RoleSkill,
	playerState: Record<string, any>,
	gameContext: {
		isFirstNight: boolean;
		currentDay: number;
	},
): boolean {
	if (!skill.usageLimit) return true;

	const { total, firstNightOnly } = skill.usageLimit;

	if (firstNightOnly && !gameContext.isFirstNight) {
		return false;
	}

	if (total !== undefined) {
		const usedCount = playerState[`${skill.id}_used_count`] || 0;
		return usedCount < total;
	}

	return true;
}
