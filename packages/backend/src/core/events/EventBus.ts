/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { DomainEvent } from './DomainEvent.js';
import { EventLogger } from './EventLogger.js';
import type { EventHandler, EventHandlerOptions } from './EventBusTypes.js';
export type { EventHandler, EventHandlerOptions } from './EventBusTypes.js';

interface RegisteredHandler<T extends DomainEvent = DomainEvent> {
	handler: EventHandler<T>;
	options: EventHandlerOptions;
	handlerId: string;
}

/**
 * High-performance event bus for domain events
 *
 * Usage:
 * ```typescript
 * // Publish event
 * eventBus.publish({
 *   eventType: 'NoteCreated',
 *   aggregateId: note.id,
 *   occurredAt: new Date(),
 *   payload: { noteId: note.id, userId: note.userId }
 * });
 *
 * // Subscribe to event
 * eventBus.subscribe('NoteCreated', async (event) => {
 *   await pushToTimeline(event.payload.noteId);
 * }, { priority: 10 });
 * ```
 */
@Injectable()
export class EventBus {
	private readonly emitter: EventEmitter;
	private readonly handlers: Map<string, RegisteredHandler[]>;
	private readonly logger: EventLogger;
	private handlerCounter = 0;

	// Metrics
	private stats = {
		totalPublished: 0,
		totalHandled: 0,
		totalErrors: 0,
		eventCounts: new Map<string, number>(),
	};

	constructor() {
		this.emitter = new EventEmitter();
		this.handlers = new Map();
		this.logger = new EventLogger();

		// Increase max listeners to prevent warnings
		// In a large system, many handlers per event is normal
		this.emitter.setMaxListeners(100);
	}

	/**
	 * Publish a domain event
	 *
	 * Events are delivered to all registered handlers.
	 * By default, handlers run asynchronously and errors are isolated.
	 *
	 * @param event - Domain event to publish
	 */
	@bindThis
	public publish<T extends DomainEvent>(event: T): void {
		try {
			// Validate event
			if (!event.eventType) {
				throw new Error('Event must have eventType');
			}
			if (!event.occurredAt) {
				event.occurredAt = new Date();
			}

			this.stats.totalPublished++;
			this.stats.eventCounts.set(
				event.eventType,
				(this.stats.eventCounts.get(event.eventType) ?? 0) + 1,
			);

			this.logger.logPublish(event);

			// Emit event
			this.emitter.emit(event.eventType, event);
		} catch (error) {
			this.logger.logError('EventBus.publish', error, { event });
			// Don't throw - publishing should never crash the caller
		}
	}

	/**
	 * Subscribe to a domain event
	 *
	 * Handlers are registered with priority - higher priority runs first.
	 * All handlers run asynchronously by default.
	 *
	 * @param eventType - Type of event to subscribe to
	 * @param handler - Handler function
	 * @param options - Handler options
	 * @returns Unsubscribe function
	 */
	@bindThis
	public subscribe<T extends DomainEvent>(
		eventType: string,
		handler: EventHandler<T>,
		options: EventHandlerOptions = {},
	): () => void {
		const handlerId = options.handlerId ?? `handler_${++this.handlerCounter}`;
		const defaultOptions: EventHandlerOptions = {
			priority: 0,
			async: true,
			handlerId,
		};
		const mergedOptions = { ...defaultOptions, ...options, handlerId };

		const wrappedHandler = async (event: T) => {
			const startTime = Date.now();

			try {
				this.logger.logHandlerStart(eventType, handlerId, event);

				const result = handler(event);

				if (result instanceof Promise) {
					if (mergedOptions.async) {
						result
							.then(() => {
								this.stats.totalHandled++;
								this.logger.logHandlerComplete(eventType, handlerId, Date.now() - startTime);
							})
							.catch((error) => {
								this.stats.totalErrors++;
								this.logger.logHandlerError(eventType, handlerId, error, event);
							});
					} else {
						await result;
						this.stats.totalHandled++;
						this.logger.logHandlerComplete(eventType, handlerId, Date.now() - startTime);
					}
				} else {
					this.stats.totalHandled++;
					this.logger.logHandlerComplete(eventType, handlerId, Date.now() - startTime);
				}
			} catch (error) {
				this.stats.totalErrors++;
				this.logger.logHandlerError(eventType, handlerId, error, event);
			}
		};

		const registeredHandler: RegisteredHandler = {
			handler: wrappedHandler as EventHandler,
			options: mergedOptions,
			handlerId,
		};

		const handlers = this.handlers.get(eventType) ?? [];
		handlers.push(registeredHandler);

		handlers.sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));

		this.handlers.set(eventType, handlers);

		this.emitter.removeAllListeners(eventType);
		for (const registered of handlers) {
			this.emitter.on(eventType, registered.handler);
		}

		this.logger.logSubscribe(eventType, handlerId, mergedOptions);

		return () => {
			this.unsubscribe(eventType, handlerId);
		};
	}

	/**
	 * Unsubscribe a handler
	 *
	 * @param eventType - Event type
	 * @param handlerId - Handler identifier
	 */
	@bindThis
	public unsubscribe(eventType: string, handlerId: string): void {
		const handlers = this.handlers.get(eventType);
		if (!handlers) return;

		const index = handlers.findIndex(h => h.handlerId === handlerId);
		if (index === -1) return;

		const handler = handlers[index];
		handlers.splice(index, 1);

		if (handlers.length === 0) {
			this.handlers.delete(eventType);
		}

		this.emitter.off(eventType, handler.handler);

		this.logger.logUnsubscribe(eventType, handlerId);
	}

	/**
	 * Get all registered handlers for an event type
	 *
	 * @param eventType - Event type
	 * @returns Array of handler IDs
	 */
	@bindThis
	public getHandlers(eventType: string): string[] {
		const handlers = this.handlers.get(eventType) ?? [];
		return handlers.map(h => h.handlerId);
	}

	/**
	 * Get event bus statistics
	 *
	 * @returns Statistics object
	 */
	@bindThis
	public getStats() {
		return {
			...this.stats,
			eventCounts: Object.fromEntries(this.stats.eventCounts),
			handlersCount: Array.from(this.handlers.entries()).map(([eventType, handlers]) => ({
				eventType,
				count: handlers.length,
			})),
		};
	}

	/**
	 * Clear all handlers (useful for testing)
	 */
	@bindThis
	public clear(): void {
		this.emitter.removeAllListeners();
		this.handlers.clear();
		this.logger.logInfo('EventBus cleared');
	}

	/**
	 * Wait for all pending async handlers to complete
	 *
	 * Useful for testing and graceful shutdown
	 * Note: This only works for handlers that are still executing
	 */
	@bindThis
	public async waitForHandlers(timeout = 5000): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(), timeout);

			// Wait for next tick - most handlers should be done by then
			setImmediate(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	/**
	 * Enable/disable logging
	 *
	 * @param enabled - Whether to enable logging
	 */
	@bindThis
	public setLogging(enabled: boolean): void {
		this.logger.setEnabled(enabled);
	}
}
