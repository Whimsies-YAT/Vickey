/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Timeline Cache Domain Model
 *
 * Represents the state and operations of a user's timeline cache.
 * This is a pure domain model with no external dependencies.
 */

export interface TimelineCacheState {
	userId: string;
	currentSize: number;
	maxSize: number;
	oldestNoteId: string | null;
	lastWarmedAt: Date | null;
}

export class TimelineCache {
	private constructor(
		public readonly userId: string,
		public readonly currentSize: number,
		public readonly maxSize: number,
		public readonly oldestNoteId: string | null,
		public readonly lastWarmedAt: Date | null,
	) {}

	/**
	 * Factory: Create from current state
	 */
	static fromState(state: TimelineCacheState): TimelineCache {
		return new TimelineCache(
			state.userId,
			state.currentSize,
			state.maxSize,
			state.oldestNoteId,
			state.lastWarmedAt,
		);
	}

	/**
	 * Domain Logic: Check if cache is sparse
	 *
	 * A sparse cache means it has less than half of the target size.
	 */
	isSparse(): boolean {
		return this.currentSize < this.maxSize * 0.5;
	}

	/**
	 * Domain Logic: Check if recently warmed
	 *
	 * Don't warm the same timeline too frequently (within 1 hour)
	 */
	isRecentlyWarmed(): boolean {
		if (!this.lastWarmedAt) return false;
		const oneHourAgo = new Date(Date.now() - 3600000);
		return this.lastWarmedAt > oneHourAgo;
	}

	/**
	 * Domain Logic: Calculate how many notes to warm
	 */
	calculateWarmTarget(targetSize: number): number {
		if (this.currentSize >= targetSize) return 0;
		return targetSize - this.currentSize;
	}

	/**
	 * Domain Logic: Check if warming is needed
	 */
	needsWarming(): boolean {
		return this.isSparse() && !this.isRecentlyWarmed();
	}

	/**
	 * Domain Logic: Create a new state after warming
	 */
	afterWarming(notesAdded: number): TimelineCache {
		return new TimelineCache(
			this.userId,
			Math.min(this.currentSize + notesAdded, this.maxSize),
			this.maxSize,
			this.oldestNoteId, // Will be updated by infrastructure
			new Date(),
		);
	}
}
