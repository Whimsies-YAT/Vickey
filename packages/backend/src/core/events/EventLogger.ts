/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { bindThis } from '@/decorators.js';
import type { DomainEvent } from './DomainEvent.js';
import type { EventHandlerOptions } from './EventBusTypes.js';

/**
 * Logger for EventBus operations
 */
export class EventLogger {
	private enabled = process.env.NODE_ENV !== 'production';

	@bindThis
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	@bindThis
	public logPublish(event: DomainEvent): void {
		if (!this.enabled) return;

		console.log(`[EventBus] PUBLISH ${event.eventType}`, {
			aggregateId: event.aggregateId,
			occurredAt: event.occurredAt.toISOString(),
			correlationId: event.correlationId,
		});
	}

	@bindThis
	public logSubscribe(eventType: string, handlerId: string, options: EventHandlerOptions): void {
		if (!this.enabled) return;

		console.log(`[EventBus] SUBSCRIBE ${eventType}`, {
			handlerId,
			priority: options.priority,
			async: options.async,
		});
	}

	@bindThis
	public logUnsubscribe(eventType: string, handlerId: string): void {
		if (!this.enabled) return;

		console.log(`[EventBus] UNSUBSCRIBE ${eventType}`, {
			handlerId,
		});
	}

	@bindThis
	public logHandlerStart(eventType: string, handlerId: string, event: DomainEvent): void {
		if (!this.enabled) return;

		console.log(`[EventBus] HANDLER START ${eventType}:${handlerId}`, {
			aggregateId: event.aggregateId,
			occurredAt: event.occurredAt.toISOString(),
		});
	}

	@bindThis
	public logHandlerComplete(eventType: string, handlerId: string, durationMs: number): void {
		if (!this.enabled) return;

		const level = durationMs > 1000 ? 'warn' : 'log';
		console[level](`[EventBus] HANDLER COMPLETE ${eventType}:${handlerId}`, {
			durationMs,
		});
	}

	@bindThis
	public logHandlerError(eventType: string, handlerId: string, error: any, event: DomainEvent): void {
		console.error(`[EventBus] HANDLER ERROR ${eventType}:${handlerId}`, {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			aggregateId: event.aggregateId,
			eventType: event.eventType,
		});
	}

	@bindThis
	public logError(context: string, error: any, metadata?: Record<string, any>): void {
		console.error(`[EventBus] ERROR ${context}`, {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			...metadata,
		});
	}

	@bindThis
	public logInfo(message: string, metadata?: Record<string, any>): void {
		if (!this.enabled) return;

		console.log(`[EventBus] ${message}`, metadata);
	}
}
