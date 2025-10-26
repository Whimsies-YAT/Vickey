/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TypedDomainEvent } from './DomainEvent.js';

/**
 * Domain Events Registry
 *
 * This file defines all domain events in the system.
 * Events are grouped by aggregate for clarity.
 *
 * Naming convention:
 * - Events are named in past tense (e.g., NoteCreated, UserFollowed)
 * - Events represent facts that already happened
 * - Event names should be understandable by domain experts
 */

// ============================================================================
// Note Aggregate Events
// ============================================================================

export interface NoteCreatedPayload {
	noteId: string;
	userId: string;
	userHost: string | null;
	text: string | null;
	cw: string | null;
	visibility: 'public' | 'home' | 'followers' | 'specified';
	localOnly: boolean;
	replyId: string | null;
	renoteId: string | null;
	channelId: string | null;
	fileIds: string[];
	hasPoll: boolean;
	tags: string[];
}

export type NoteCreatedEvent = TypedDomainEvent<'NoteCreated', NoteCreatedPayload>;

export interface NoteDeletedPayload {
	noteId: string;
	userId: string;
	deletedAt: Date;
}

export type NoteDeletedEvent = TypedDomainEvent<'NoteDeleted', NoteDeletedPayload>;

export interface NoteReactedPayload {
	noteId: string;
	userId: string;
	reaction: string;
}

export type NoteReactedEvent = TypedDomainEvent<'NoteReacted', NoteReactedPayload>;

export interface NoteUnreactedPayload {
	noteId: string;
	userId: string;
	reaction: string;
}

export type NoteUnreactedEvent = TypedDomainEvent<'NoteUnreacted', NoteUnreactedPayload>;

// ============================================================================
// User Aggregate Events
// ============================================================================

export interface UserFollowedPayload {
	followerId: string;
	followeeId: string;
	withReplies: boolean;
}

export type UserFollowedEvent = TypedDomainEvent<'UserFollowed', UserFollowedPayload>;

export interface UserUnfollowedPayload {
	followerId: string;
	followeeId: string;
}

export type UserUnfollowedEvent = TypedDomainEvent<'UserUnfollowed', UserUnfollowedPayload>;

export interface UserBlockedPayload {
	blockerId: string;
	blockeeId: string;
}

export type UserBlockedEvent = TypedDomainEvent<'UserBlocked', UserBlockedPayload>;

export interface UserUnblockedPayload {
	blockerId: string;
	blockeeId: string;
}

export type UserUnblockedEvent = TypedDomainEvent<'UserUnblocked', UserUnblockedPayload>;

export interface UserSuspendedPayload {
	userId: string;
	reason: string | null;
	suspendedBy: string | null;
}

export type UserSuspendedEvent = TypedDomainEvent<'UserSuspended', UserSuspendedPayload>;

export interface UserUnsuspendedPayload {
	userId: string;
	unsuspendedBy: string | null;
}

export type UserUnsuspendedEvent = TypedDomainEvent<'UserUnsuspended', UserUnsuspendedPayload>;

export interface UserCreatedPayload {
	userId: string;
	username: string;
	host: string | null;
}

export type UserCreatedEvent = TypedDomainEvent<'UserCreated', UserCreatedPayload>;

export interface UserProfileUpdatedPayload {
	userId: string;
	fields: string[];
}

export type UserProfileUpdatedEvent = TypedDomainEvent<'UserProfileUpdated', UserProfileUpdatedPayload>;

// ============================================================================
// Drive Aggregate Events
// ============================================================================

export interface DriveFileCreatedPayload {
	fileId: string;
	userId: string;
	name: string;
	type: string;
	size: number;
	md5: string;
	folderId: string | null;
}

export type DriveFileCreatedEvent = TypedDomainEvent<'DriveFileCreated', DriveFileCreatedPayload>;

export interface DriveFileDeletedPayload {
	fileId: string;
	userId: string;
}

export type DriveFileDeletedEvent = TypedDomainEvent<'DriveFileDeleted', DriveFileDeletedPayload>;

// ============================================================================
// Channel Aggregate Events
// ============================================================================

export interface ChannelFollowedPayload {
	channelId: string;
	userId: string;
}

export type ChannelFollowedEvent = TypedDomainEvent<'ChannelFollowed', ChannelFollowedPayload>;

export interface ChannelUnfollowedPayload {
	channelId: string;
	userId: string;
}

export type ChannelUnfollowedEvent = TypedDomainEvent<'ChannelUnfollowed', ChannelUnfollowedPayload>;

// ============================================================================
// Notification Events
// ============================================================================

export interface NotificationCreatedPayload {
	notificationId: string;
	recipientId: string;
	type: string;
	senderId: string | null;
}

export type NotificationCreatedEvent = TypedDomainEvent<'NotificationCreated', NotificationCreatedPayload>;

// ============================================================================
// Chat Aggregate Events
// ============================================================================

export interface ChatMessageSentPayload {
	messageId: string;
	roomId: string;
	userId: string;
	text: string | null;
	fileId: string | null;
}

export type ChatMessageSentEvent = TypedDomainEvent<'ChatMessageSent', ChatMessageSentPayload>;

// ============================================================================
// System Events
// ============================================================================

export interface UserSessionCreatedPayload {
	sessionId: string;
	userId: string;
	ip: string;
	userAgent: string;
}

export type UserSessionCreatedEvent = TypedDomainEvent<'UserSessionCreated', UserSessionCreatedPayload>;

export interface AbuseReportCreatedPayload {
	reportId: string;
	reporterId: string;
	targetUserId: string | null;
	targetNoteId: string | null;
	comment: string;
}

export type AbuseReportCreatedEvent = TypedDomainEvent<'AbuseReportCreated', AbuseReportCreatedPayload>;

// ============================================================================
// Union type of all domain events
// ============================================================================

export type AnyDomainEvent =
	// Note events
	| NoteCreatedEvent
	| NoteDeletedEvent
	| NoteReactedEvent
	| NoteUnreactedEvent
	// User events
	| UserFollowedEvent
	| UserUnfollowedEvent
	| UserBlockedEvent
	| UserUnblockedEvent
	| UserSuspendedEvent
	| UserUnsuspendedEvent
	| UserCreatedEvent
	| UserProfileUpdatedEvent
	// Drive events
	| DriveFileCreatedEvent
	| DriveFileDeletedEvent
	// Channel events
	| ChannelFollowedEvent
	| ChannelUnfollowedEvent
	// Notification events
	| NotificationCreatedEvent
	// Chat events
	| ChatMessageSentEvent
	// System events
	| UserSessionCreatedEvent
	| AbuseReportCreatedEvent;
