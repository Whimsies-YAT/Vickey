/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DomainEvent } from './DomainEvent.js';
import type { EventHandlerOptions } from './EventBus.js';

/**
 * Metadata key for event handler decorators
 */
export const EVENT_HANDLER_METADATA = Symbol('EVENT_HANDLER_METADATA');

/**
 * Event handler metadata
 */
export interface EventHandlerMetadata {
	eventType: string;
	methodName: string;
	options: EventHandlerOptions;
}

/**
 * Decorator for marking methods as event handlers
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class TimelinePushHandler {
 *   constructor(private eventBus: EventBus) {}
 *
 *   @OnEvent('NoteCreated', { priority: 10 })
 *   async handleNoteCreated(event: NoteCreatedEvent): Promise<void> {
 *     await this.pushToTimeline(event.noteId);
 *   }
 * }
 * ```
 *
 * @param eventType - Type of event to handle
 * @param options - Handler options
 */
export function OnEvent(eventType: string, options: EventHandlerOptions = {}): MethodDecorator {
	return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
		// Store metadata on the class prototype
		const existingHandlers: EventHandlerMetadata[] =
			Reflect.getMetadata(EVENT_HANDLER_METADATA, target.constructor) || [];

		const metadata: EventHandlerMetadata = {
			eventType,
			methodName: propertyKey.toString(),
			options: {
				...options,
				handlerId: options.handlerId || `${target.constructor.name}.${propertyKey.toString()}`,
			},
		};

		existingHandlers.push(metadata);

		Reflect.defineMetadata(EVENT_HANDLER_METADATA, existingHandlers, target.constructor);

		return descriptor;
	};
}

/**
 * Get all event handler metadata from a class
 *
 * @param target - Class to get metadata from
 * @returns Array of event handler metadata
 */
export function getEventHandlerMetadata(target: any): EventHandlerMetadata[] {
	return Reflect.getMetadata(EVENT_HANDLER_METADATA, target) || [];
}

/**
 * Interface for event handler classes
 *
 * Implement this interface to create a typed event handler
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class TimelinePushHandler implements EventHandlerInterface<NoteCreatedEvent> {
 *   async handle(event: NoteCreatedEvent): Promise<void> {
 *     // Handle event
 *   }
 * }
 * ```
 */
export interface EventHandlerInterface<T extends DomainEvent = DomainEvent> {
	handle(event: T): Promise<void> | void;
}
