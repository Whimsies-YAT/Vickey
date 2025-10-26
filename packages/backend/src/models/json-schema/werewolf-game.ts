/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedWerewolfGameLiteSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		startedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		endedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		isStarted: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		isEnded: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		hostId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		host: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		mode: {
			type: 'string',
			optional: false, nullable: false,
		},
		maxPlayers: {
			type: 'number',
			optional: false, nullable: false,
		},
		currentPlayers: {
			type: 'number',
			optional: false, nullable: false,
		},
		winnerTeam: {
			type: 'string',
			optional: false, nullable: true,
		},
		phase: {
			type: 'string',
			optional: false, nullable: true,
		},
		seats: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
		players: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const packedWerewolfGameDetailedSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		startedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		endedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		isStarted: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		isEnded: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		hostId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		host: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		config: {
			type: 'object',
			optional: false, nullable: false,
		},
		phase: {
			type: 'string',
			optional: false, nullable: true,
		},
		subPhase: {
			type: 'string',
			optional: false, nullable: true,
		},
		dayNumber: {
			type: 'number',
			optional: false, nullable: true,
		},
		seats: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
		players: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
		allPlayers: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'UserLite',
			},
		},
		winnerTeam: {
			type: 'string',
			optional: false, nullable: true,
		},
		logs: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
		currentActions: {
			type: 'object',
			optional: false, nullable: false,
		},
		voiceSessionId: {
			type: 'string',
			optional: false, nullable: true,
		},
		phaseStartedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		phaseEndsAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
	},
} as const;
