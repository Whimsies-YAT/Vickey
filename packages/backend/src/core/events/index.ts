/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * EventBus - Domain Event System
 *
 * A high-performance, production-ready event bus for domain events.
 *
 * Quick Start:
 * ```typescript
 * // 1. Import EventBus
 * import { EventBus, type NoteCreatedEvent } from '@/core/events';
 *
 * // 2. Inject in your service
 * constructor(private eventBus: EventBus) {}
 *
 * // 3. Publish events
 * this.eventBus.publish<NoteCreatedEvent>({
 *   eventType: 'NoteCreated',
 *   aggregateId: note.id,
 *   occurredAt: new Date(),
 *   noteId: note.id,
 *   userId: note.userId,
 *   // ... other fields
 * });
 *
 * // 4. Subscribe to events
 * this.eventBus.subscribe<NoteCreatedEvent>(
 *   'NoteCreated',
 *   async (event) => {
 *     await this.handleNoteCreated(event);
 *   },
 *   { priority: 10 }
 * );
 * ```
 *
 * Advanced Usage:
 * ```typescript
 * // Use decorator for cleaner code
 * @Injectable()
 * class TimelinePushHandler {
 *   @OnEvent('NoteCreated', { priority: 10 })
 *   async handleNoteCreated(event: NoteCreatedEvent) {
 *     await this.pushToTimeline(event.noteId);
 *   }
 * }
 * ```
 */

// Core
export { EventBus } from './EventBus.js';
export type { EventHandler, EventHandlerOptions } from './EventBus.js';

// Domain events
export type { DomainEvent, TypedDomainEvent } from './DomainEvent.js';
export * from './DomainEvents.js';

// Decorators and interfaces
export { OnEvent, getEventHandlerMetadata } from './EventHandler.decorator.js';
export type { EventHandlerMetadata, EventHandlerInterface } from './EventHandler.decorator.js';

// Module
export { EventBusModule } from './EventBusModule.js';

// Utilities
export { EventLogger } from './EventLogger.js';
export { EventMetrics } from './EventMetrics.js';
