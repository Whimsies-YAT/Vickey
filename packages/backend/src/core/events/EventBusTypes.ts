/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DomainEvent } from './DomainEvent.js';

/**
 * Event Handler Function Type
 */
export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void> | void;

/**
 * Event Handler Registration Options
 */
export interface EventHandlerOptions {
	/**
	 * Handler priority (higher number = earlier execution)
	 * Default: 0
	 */
	priority?: number;

	/**
	 * Whether this handler should run asynchronously (fire-and-forget)
	 * Default: true
	 */
	async?: boolean;

	/**
	 * Handler identifier for logging and debugging
	 */
	handlerId?: string;
}
