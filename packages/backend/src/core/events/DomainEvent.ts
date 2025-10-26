/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Base interface for all domain events
 *
 * A domain event represents something that happened in the domain
 * that domain experts care about.
 */
export interface DomainEvent {
	/**
	 * Type of the event (e.g., 'NoteCreated', 'UserFollowed')
	 * This is used for routing to handlers
	 */
	eventType: string;

	/**
	 * When the event occurred
	 * Auto-populated by EventBus if not provided
	 */
	occurredAt: Date;

	/**
	 * ID of the aggregate root that this event relates to
	 * For tracing and debugging
	 */
	aggregateId: string;

	/**
	 * Optional: Type of aggregate (e.g., 'Note', 'User')
	 */
	aggregateType?: string;

	/**
	 * Optional: Correlation ID for tracing related events
	 */
	correlationId?: string;

	/**
	 * Optional: Causation ID (ID of the event that caused this event)
	 */
	causationId?: string;

	/**
	 * Event-specific payload
	 */
	[key: string]: any;
}

/**
 * Helper type for creating domain events with strong typing
 *
 * Usage:
 * ```typescript
 * interface NoteCreatedPayload {
 *   noteId: string;
 *   userId: string;
 *   text: string;
 * }
 *
 * type NoteCreatedEvent = TypedDomainEvent<'NoteCreated', NoteCreatedPayload>;
 * ```
 */
export type TypedDomainEvent<TType extends string, TPayload extends Record<string, any>> =
	DomainEvent & {
		eventType: TType;
	} & TPayload;
