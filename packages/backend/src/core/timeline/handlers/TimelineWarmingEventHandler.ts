/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { EventBus } from '@/core/events/EventBus.js';
import type { NoteCreatedEvent, UserFollowedEvent } from '@/core/events/DomainEvents.js';
import { TimelineWarmingService } from '../application/TimelineWarmingService.js';

/**
 * Timeline Warming Event Handler
 *
 * Listens to domain events and triggers timeline warming.
 * This is the integration point between the event system and warming logic.
 *
 * Architecture:
 * - Events (infrastructure) → Handler (this) → Application Service → Domain Logic
 * - Pure event handling, no business logic here
 * - All handlers are async/non-blocking
 *
 * Pattern: Imperative subscription (matches NoteEventHandlers pattern)
 */
@Injectable()
export class TimelineWarmingEventHandler {
	constructor(
		private readonly eventBus: EventBus,
		private readonly timelineWarmingService: TimelineWarmingService,
	) {
		console.log('[TimelineWarmingEventHandler] Constructor called, subscribing to events');

		this.eventBus.subscribe<NoteCreatedEvent>(
			'NoteCreated',
			this.handleNoteCreated,
			{
				priority: 5,
				async: true,
				handlerId: 'TimelineWarmingEventHandler.handleNoteCreated',
			},
		);

		this.eventBus.subscribe<UserFollowedEvent>(
			'UserFollowed',
			this.handleUserFollowed,
			{
				priority: 5,
				async: true,
				handlerId: 'TimelineWarmingEventHandler.handleUserFollowed',
			},
		);

		console.log('[TimelineWarmingEventHandler] Successfully subscribed to events');
	}

	/**
	 * Event: Note Created
	 *
	 * When a user posts a note, their timeline might be viewed by:
	 * - Followers who see it in their feed
	 * - Users who click through to the author's profile
	 *
	 * Strategy: Warm timeline for users with many followers (high visibility)
	 */
	@bindThis
	private async handleNoteCreated(event: NoteCreatedEvent): Promise<void> {
		const { userId, userHost } = event;

		if (userHost !== null) return;

		await this.timelineWarmingService.warmTimelineAsync(userId, 'note_created');
	}

	/**
	 * Event: User Followed
	 *
	 * When user A follows user B, user A is very likely to:
	 * - View B's timeline immediately
	 * - Check out B's older posts
	 *
	 * Strategy: Proactively warm B's timeline (high priority)
	 */
	@bindThis
	private async handleUserFollowed(event: UserFollowedEvent): Promise<void> {
		const { followeeId } = event;

		await this.timelineWarmingService.warmTimelineAsync(followeeId, 'user_followed');
	}

	/**
	 * Event: User Profile Accessed (future extension)
	 *
	 * If we add a ProfileViewedEvent in the future, we can warm on-demand:
	 *
	 * this.eventBus.subscribe<ProfileViewedEvent>(
	 *   'ProfileViewed',
	 *   this.handleProfileViewed,
	 *   { priority: 5, async: true, handlerId: 'TimelineWarmingEventHandler.handleProfileViewed' }
	 * );
	 *
	 * private async handleProfileViewed(event: ProfileViewedEvent) {
	 *   await this.timelineWarmingService.warmTimelineAsync(
	 *     event.profileUserId,
	 *     'profile_accessed'
	 *   );
	 * }
	 */
}
