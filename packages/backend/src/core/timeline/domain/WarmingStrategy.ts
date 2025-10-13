/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiUser } from '@/models/User.js';

/**
 * Timeline Warming Strategy (Domain Layer)
 *
 * Encapsulates the business rules for deciding when and how to warm timelines.
 * Pure domain logic, no infrastructure dependencies.
 */

export interface WarmingDecision {
	shouldWarm: boolean;
	reason: string;
	priority: 'high' | 'normal' | 'low';
	targetSize: number;
}

export class WarmingStrategy {
	constructor(
		private readonly minNotesCount: number,
		private readonly minFollowersForPredictive: number,
		private readonly defaultTargetSize: number,
	) {}

	/**
	 * Decide if a user's timeline should be warmed based on their profile
	 */
	shouldWarmForUser(user: MiUser): WarmingDecision {
		// Rule 1: User must have enough notes to make warming worthwhile
		if (user.notesCount < this.minNotesCount) {
			return {
				shouldWarm: false,
				reason: `User has only ${user.notesCount} notes (min: ${this.minNotesCount})`,
				priority: 'low',
				targetSize: 0,
			};
		}

		// Rule 2: Determine priority based on followers count
		let priority: 'high' | 'normal' | 'low';
		if (user.followersCount >= this.minFollowersForPredictive * 10) {
			priority = 'high'; // Popular users: warm proactively
		} else if (user.followersCount >= this.minFollowersForPredictive) {
			priority = 'normal'; // Active users: warm on events
		} else {
			priority = 'low'; // Low-activity users: warm reactively
		}

		// Rule 3: Calculate target size based on user activity
		const targetSize = this.calculateTargetSize(user);

		return {
			shouldWarm: true,
			reason: `User has ${user.notesCount} notes and ${user.followersCount} followers`,
			priority,
			targetSize,
		};
	}

	/**
	 * Calculate optimal cache size based on user profile
	 */
	private calculateTargetSize(user: MiUser): number {
		const totalNotes = user.notesCount;

		// Strategy: Load more for prolific users, but cap at target
		if (totalNotes < 500) {
			return Math.min(totalNotes, this.defaultTargetSize);
		} else if (totalNotes < 5000) {
			return this.defaultTargetSize;
		} else {
			// Very prolific users: load up to 2x default
			return Math.min(this.defaultTargetSize * 2, 2000);
		}
	}

	/**
	 * Decide priority based on event trigger
	 */
	priorityForTrigger(trigger: 'note_created' | 'user_followed' | 'profile_accessed'): 'high' | 'normal' | 'low' {
		switch (trigger) {
			case 'user_followed':
				return 'high'; // User just followed, very likely to view timeline
			case 'note_created':
				return 'normal'; // User posted, moderately likely others will visit
			case 'profile_accessed':
				return 'normal'; // User is being viewed right now
			default:
				return 'low';
		}
	}
}
