/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { EventBus } from './EventBus.js';

/**
 * Event metrics collector
 *
 * Provides real-time metrics for monitoring EventBus performance:
 * - Event publish rate
 * - Handler execution time
 * - Error rate
 * - Queue depth
 *
 * Usage:
 * ```typescript
 * const metrics = eventMetrics.getMetrics();
 * console.log(`Event rate: ${metrics.eventsPerSecond}/s`);
 * console.log(`Error rate: ${metrics.errorRate}%`);
 * ```
 */
@Injectable()
export class EventMetrics {
	private startTime = Date.now();
	private readonly handlerTimings: Map<string, number[]> = new Map();
	private readonly errorCounts: Map<string, number> = new Map();

	constructor(private readonly eventBus: EventBus) {}

	/**
	 * Get current metrics snapshot
	 */
	@bindThis
	public getMetrics() {
		const stats = this.eventBus.getStats();
		const uptimeSeconds = (Date.now() - this.startTime) / 1000;

		// Calculate rates
		const eventsPerSecond = stats.totalPublished / uptimeSeconds;
		const handledPerSecond = stats.totalHandled / uptimeSeconds;
		const errorRate = stats.totalPublished > 0
			? (stats.totalErrors / stats.totalHandled) * 100
			: 0;

		// Calculate handler performance
		const handlerPerformance = Array.from(this.handlerTimings.entries()).map(([handlerId, timings]) => {
			const avg = timings.reduce((sum, t) => sum + t, 0) / timings.length;
			const min = Math.min(...timings);
			const max = Math.max(...timings);
			const p95 = this.percentile(timings, 0.95);
			const p99 = this.percentile(timings, 0.99);

			return {
				handlerId,
				avgMs: avg,
				minMs: min,
				maxMs: max,
				p95Ms: p95,
				p99Ms: p99,
				executions: timings.length,
			};
		});

		return {
			uptime: {
				seconds: Math.floor(uptimeSeconds),
				formatted: this.formatUptime(uptimeSeconds),
			},
			events: {
				totalPublished: stats.totalPublished,
				totalHandled: stats.totalHandled,
				totalErrors: stats.totalErrors,
				eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
				handledPerSecond: Math.round(handledPerSecond * 100) / 100,
				errorRate: Math.round(errorRate * 100) / 100,
			},
			eventTypes: stats.eventCounts,
			handlers: stats.handlersCount,
			handlerPerformance: handlerPerformance.sort((a, b) => b.p99Ms - a.p99Ms),
		};
	}

	/**
	 * Get metrics as human-readable text report
	 */
	@bindThis
	public getReport(): string {
		const metrics = this.getMetrics();
		const lines: string[] = [];

		lines.push('='.repeat(60));
		lines.push('EventBus Metrics Report');
		lines.push('='.repeat(60));
		lines.push('');

		lines.push(`Uptime: ${metrics.uptime.formatted}`);
		lines.push('');

		lines.push('Event Statistics:');
		lines.push(`  Total Published: ${metrics.events.totalPublished}`);
		lines.push(`  Total Handled:   ${metrics.events.totalHandled}`);
		lines.push(`  Total Errors:    ${metrics.events.totalErrors}`);
		lines.push(`  Events/sec:      ${metrics.events.eventsPerSecond}`);
		lines.push(`  Handled/sec:     ${metrics.events.handledPerSecond}`);
		lines.push(`  Error Rate:      ${metrics.events.errorRate}%`);
		lines.push('');

		lines.push('Event Types:');
		const sortedEvents = Object.entries(metrics.eventTypes)
			.sort(([, a], [, b]) => (b as number) - (a as number));
		for (const [eventType, count] of sortedEvents) {
			lines.push(`  ${eventType}: ${count}`);
		}
		lines.push('');

		lines.push('Handler Performance (Top 10 by P99):');
		const topHandlers = metrics.handlerPerformance.slice(0, 10);
		for (const handler of topHandlers) {
			lines.push(`  ${handler.handlerId}:`);
			lines.push(`    Executions: ${handler.executions}`);
			lines.push(`    Avg: ${handler.avgMs.toFixed(2)}ms`);
			lines.push(`    P95: ${handler.p95Ms.toFixed(2)}ms`);
			lines.push(`    P99: ${handler.p99Ms.toFixed(2)}ms`);
			lines.push(`    Max: ${handler.maxMs.toFixed(2)}ms`);
		}
		lines.push('');

		lines.push('Registered Handlers:');
		for (const { eventType, count } of metrics.handlers) {
			lines.push(`  ${eventType}: ${count} handler(s)`);
		}
		lines.push('');

		lines.push('='.repeat(60));

		return lines.join('\n');
	}

	/**
	 * Record handler execution time
	 *
	 * @param handlerId - Handler identifier
	 * @param durationMs - Execution time in milliseconds
	 */
	@bindThis
	public recordHandlerTiming(handlerId: string, durationMs: number): void {
		const timings = this.handlerTimings.get(handlerId) ?? [];
		timings.push(durationMs);

		// Keep only last 1000 timings per handler
		if (timings.length > 1000) {
			timings.shift();
		}

		this.handlerTimings.set(handlerId, timings);
	}

	/**
	 * Record handler error
	 *
	 * @param handlerId - Handler identifier
	 */
	@bindThis
	public recordHandlerError(handlerId: string): void {
		const count = this.errorCounts.get(handlerId) ?? 0;
		this.errorCounts.set(handlerId, count + 1);
	}

	/**
	 * Reset all metrics
	 */
	@bindThis
	public reset(): void {
		this.startTime = Date.now();
		this.handlerTimings.clear();
		this.errorCounts.clear();
	}

	/**
	 * Calculate percentile from array of numbers
	 */
	private percentile(values: number[], p: number): number {
		if (values.length === 0) return 0;

		const sorted = [...values].sort((a, b) => a - b);
		const index = Math.ceil(sorted.length * p) - 1;
		return sorted[Math.max(0, index)];
	}

	/**
	 * Format uptime in human-readable format
	 */
	private formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		const parts: string[] = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0) parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

		return parts.join(' ');
	}
}
