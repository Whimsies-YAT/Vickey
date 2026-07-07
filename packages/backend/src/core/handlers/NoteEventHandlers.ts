/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { In, IsNull, LessThan } from 'typeorm';
import { bindThis } from '@/decorators.js';
import { EventBus } from '@/core/events/EventBus.js';
import type { NoteCreatedEvent } from '@/core/events/DomainEvents.js';
import { SearchService } from '@/core/SearchService.js';
import { FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type {
	ChannelFollowingsRepository,
	FollowingsRepository,
	MiFollowing,
	MiMeta,
	UserListMembershipsRepository,
	UsersRepository,
} from '@/models/_.js';
import { isReply } from '@/misc/is-reply.js';

/**
 * Unified event handlers for Note-related domain events
 *
 * Consolidates all Note event handling logic:
 * - Search indexing
 * - Timeline fanout
 * - (future: notifications, webhooks, etc.)
 */
@Injectable()
export class NoteEventHandlers {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redisForTimelines)
		private redisForTimelines: Redis.Redis,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.channelFollowingsRepository)
		private channelFollowingsRepository: ChannelFollowingsRepository,

		@Inject(DI.userListMembershipsRepository)
		private userListMembershipsRepository: UserListMembershipsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private eventBus: EventBus,
		private searchService: SearchService,
		private fanoutTimelineService: FanoutTimelineService,
	) {
		console.log('[NoteEventHandlers] Constructor called, subscribing to NoteCreated event');
		// Subscribe to NoteCreated event once, handle all side effects
		this.eventBus.subscribe<NoteCreatedEvent>(
			'NoteCreated',
			this.handleNoteCreated,
			{
				priority: 0,
				async: true,
				handlerId: 'NoteEventHandlers.handleNoteCreated',
			},
		);
		console.log('[NoteEventHandlers] Successfully subscribed to NoteCreated event');
	}

	@bindThis
	private async handleNoteCreated(event: NoteCreatedEvent): Promise<void> {
		// Run all handlers in parallel for better performance
		await Promise.allSettled([
			this.handleSearchIndexing(event),
			this.handleTimelineFanout(event),
		]);
	}

	// ============================================================================
	// Search Indexing
	// ============================================================================

	@bindThis
	private async handleSearchIndexing(event: NoteCreatedEvent): Promise<void> {
		if (event.text == null && event.cw == null) {
			return;
		}

		try {
			await this.searchService.indexNote({
				id: event.noteId,
				text: event.text,
				cw: event.cw,
				userId: event.userId,
				userHost: event.userHost,
				visibility: event.visibility,
				channelId: event.channelId,
				tags: event.tags,
			} as any);
		} catch (error) {
			console.error(`[NoteEventHandlers] Failed to index note ${event.noteId}:`, error);
		}
	}

	// ============================================================================
	// Timeline Fanout
	// ============================================================================

	@bindThis
	private async handleTimelineFanout(event: NoteCreatedEvent): Promise<void> {
		if (!this.meta.enableFanoutTimeline) return;

		try {
			const r = this.redisForTimelines.pipeline();

			if (event.channelId) {
				await this.pushChannelTimelines(event, r);
			} else {
				await this.pushUserTimelines(event, r);
			}

			r.exec();
		} catch (error) {
			console.error(`[NoteEventHandlers] Failed to push note ${event.noteId} to timelines:`, error);
		}
	}

	@bindThis
	private async pushChannelTimelines(event: NoteCreatedEvent, r: Redis.ChainableCommander): Promise<void> {
		this.fanoutTimelineService.push(`channelTimeline:${event.channelId}`, event.noteId, this.config.perChannelMaxNoteCacheCount, r);

		this.fanoutTimelineService.push(
			`userTimelineWithChannel:${event.userId}`,
			event.noteId,
			event.userHost == null ? this.meta.perLocalUserUserTimelineCacheMax : this.meta.perRemoteUserUserTimelineCacheMax,
			r,
		);

		const channelFollowings = await this.channelFollowingsRepository.find({
			where: {
				followeeId: event.channelId!,
			},
			select: { followerId: true },
		});

		for (const channelFollowing of channelFollowings) {
			this.fanoutTimelineService.push(`homeTimeline:${channelFollowing.followerId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax, r);
			if (event.fileIds.length > 0) {
				this.fanoutTimelineService.push(`homeTimelineWithFiles:${channelFollowing.followerId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax / 2, r);
			}
		}
	}

	@bindThis
	private async pushUserTimelines(event: NoteCreatedEvent, r: Redis.ChainableCommander): Promise<void> {
		const results = await Promise.all([
			this.followingsRepository.find({
				where: {
					followeeId: event.userId,
					followerHost: IsNull(),
					isFollowerHibernated: false,
				},
				select: { followerId: true, withReplies: true },
			}),
			this.userListMembershipsRepository.find({
				where: {
					userId: event.userId,
				},
				select: { userListId: true, userListUserId: true, withReplies: true },
			}),
		]);

		const followings = results[0];
		let userListMemberships = results[1];

		if (event.visibility === 'followers') {
			userListMemberships = userListMemberships.filter(x => x.userListUserId === event.userId || followings.some(f => f.followerId === x.userListUserId));
		}

		const noteForReplyCheck = {
			id: event.noteId,
			replyId: event.replyId,
			renoteId: event.renoteId,
			visibility: event.visibility,
			visibleUserIds: [],
			userId: event.userId,
			userHost: event.userHost,
			fileIds: event.fileIds,
			replyUserId: null,
		};

		for (const following of followings) {
			if (event.visibility === 'specified') continue;

			if (isReply(noteForReplyCheck, following.followerId)) {
				if (!following.withReplies) continue;
			}

			this.fanoutTimelineService.push(`homeTimeline:${following.followerId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax, r);
			if (event.fileIds.length > 0) {
				this.fanoutTimelineService.push(`homeTimelineWithFiles:${following.followerId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax / 2, r);
			}
		}

		for (const userListMembership of userListMemberships) {
			if (
				event.visibility === 'specified' &&
				event.userId !== userListMembership.userListUserId
			) continue;

			if (isReply(noteForReplyCheck, userListMembership.userListUserId)) {
				if (!userListMembership.withReplies) continue;
			}

			this.fanoutTimelineService.push(`userListTimeline:${userListMembership.userListId}`, event.noteId, this.meta.perUserListTimelineCacheMax, r);
			if (event.fileIds.length > 0) {
				this.fanoutTimelineService.push(`userListTimelineWithFiles:${userListMembership.userListId}`, event.noteId, this.meta.perUserListTimelineCacheMax / 2, r);
			}
		}

		if (event.userHost == null) {
			if (event.visibility !== 'specified') {
				this.fanoutTimelineService.push(`homeTimeline:${event.userId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax, r);
				if (event.fileIds.length > 0) {
					this.fanoutTimelineService.push(`homeTimelineWithFiles:${event.userId}`, event.noteId, this.meta.perUserHomeTimelineCacheMax / 2, r);
				}
			}
		}

		if (isReply(noteForReplyCheck)) {
			this.fanoutTimelineService.push(
				`userTimelineWithReplies:${event.userId}`,
				event.noteId,
				event.userHost == null ? this.meta.perLocalUserUserTimelineCacheMax : this.meta.perRemoteUserUserTimelineCacheMax,
				r,
			);

			if (event.visibility === 'public' && event.userHost == null) {
				this.fanoutTimelineService.push('localTimelineWithReplies', event.noteId, 300, r);
			}
		} else {
			this.fanoutTimelineService.push(
				`userTimeline:${event.userId}`,
				event.noteId,
				event.userHost == null ? this.meta.perLocalUserUserTimelineCacheMax : this.meta.perRemoteUserUserTimelineCacheMax,
				r,
			);
			if (event.fileIds.length > 0) {
				this.fanoutTimelineService.push(
					`userTimelineWithFiles:${event.userId}`,
					event.noteId,
					event.userHost == null ? this.meta.perLocalUserUserTimelineCacheMax / 2 : this.meta.perRemoteUserUserTimelineCacheMax / 2,
					r,
				);
			}

			if (event.visibility === 'public' && event.userHost == null) {
				this.fanoutTimelineService.push('localTimeline', event.noteId, 1000, r);
				if (event.fileIds.length > 0) {
					this.fanoutTimelineService.push('localTimelineWithFiles', event.noteId, 500, r);
				}
			}
		}

		if (Math.random() < 0.1) {
			process.nextTick(() => {
				this.checkHibernation(followings);
			});
		}
	}

	@bindThis
	private async checkHibernation(followings: MiFollowing[]): Promise<void> {
		if (followings.length === 0) return;

		const shuffle = (array: MiFollowing[]) => {
			for (let i = array.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[array[i], array[j]] = [array[j], array[i]];
			}
			return array;
		};

		const samples = shuffle(followings).slice(0, Math.min(followings.length, 1000));

		const hibernatedUsers = await this.usersRepository.find({
			where: {
				id: In(samples.map(x => x.followerId)),
				lastActiveDate: LessThan(new Date(Date.now() - (1000 * 60 * 60 * 24 * 50))),
			},
			select: { id: true },
		});

		if (hibernatedUsers.length > 0) {
			this.usersRepository.update({
				id: In(hibernatedUsers.map(x => x.id)),
			}, {
				isHibernated: true,
			});

			this.followingsRepository.update({
				followerId: In(hibernatedUsers.map(x => x.id)),
			}, {
				isFollowerHibernated: true,
			});
		}
	}
}
