/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module, Global, OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventBus } from './EventBus.js';
import { getEventHandlerMetadata } from './EventHandler.decorator.js';
import { bindThis } from '@/decorators.js';

/**
 * Global EventBus module for NestJS
 *
 * This module provides:
 * 1. EventBus singleton across the application
 * 2. Automatic handler registration via @OnEvent decorator
 * 3. Graceful shutdown handling
 *
 * Usage in CoreModule:
 * ```typescript
 * @Module({
 *   imports: [EventBusModule],
 *   // ...
 * })
 * export class CoreModule {}
 * ```
 *
 * Note: Module is marked as @Global, so EventBus is available everywhere
 * without importing EventBusModule in each module.
 */
@Global()
@Module({
	providers: [EventBus],
	exports: [EventBus],
})
export class EventBusModule implements OnModuleInit, OnModuleDestroy {
	private unsubscribeFunctions: Array<() => void> = [];

	constructor(
		private readonly eventBus: EventBus,
		private readonly moduleRef: ModuleRef,
	) {}

	/**
	 * Called when module is initialized
	 *
	 * Automatically discovers and registers all @OnEvent handlers
	 */
	@bindThis
	async onModuleInit(): Promise<void> {
		// Note: Automatic handler registration is disabled by default
		// To enable, call registerHandlers() explicitly
		// this.registerHandlers();
	}

	/**
	 * Register all event handlers decorated with @OnEvent
	 *
	 * Call this method explicitly to enable automatic handler registration.
	 * By default, it's disabled to avoid surprises.
	 *
	 * Usage:
	 * ```typescript
	 * // In your bootstrap or main module
	 * const eventBusModule = app.get(EventBusModule);
	 * eventBusModule.registerHandlers();
	 * ```
	 */
	@bindThis
	public registerHandlers(): void {
		// Get all providers from the module container
		const providers = (this.moduleRef as any).container.getModules();

		for (const [, module] of providers) {
			const { providers: moduleProviders } = module;

			for (const [, provider] of moduleProviders) {
				if (!provider.instance) continue;

				const instance = provider.instance;
				const prototype = Object.getPrototypeOf(instance);

				if (!prototype) continue;

				// Get event handler metadata from the class
				const metadata = getEventHandlerMetadata(prototype.constructor);

				for (const handler of metadata) {
					const method = instance[handler.methodName];

					if (typeof method !== 'function') {
						console.warn(
							`[EventBusModule] Handler method ${handler.methodName} not found on ${prototype.constructor.name}`,
						);
						continue;
					}

					// Register handler with EventBus
					const unsubscribe = this.eventBus.subscribe(
						handler.eventType,
						method.bind(instance),
						handler.options,
					);

					this.unsubscribeFunctions.push(unsubscribe);

					console.log(
						`[EventBusModule] Registered handler ${prototype.constructor.name}.${handler.methodName} for ${handler.eventType}`,
					);
				}
			}
		}
	}

	/**
	 * Called when module is destroyed
	 *
	 * Waits for pending handlers and cleans up
	 */
	@bindThis
	async onModuleDestroy(): Promise<void> {
		console.log('[EventBusModule] Shutting down...');

		// Wait for pending handlers to complete
		await this.eventBus.waitForHandlers(5000);

		// Unsubscribe all handlers
		for (const unsubscribe of this.unsubscribeFunctions) {
			unsubscribe();
		}

		console.log('[EventBusModule] Shutdown complete');
	}
}
