/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';

export interface LogEntry {
	id: number;
	timestamp: string;
	type: 'stdout' | 'stderr';
	content: string;
}

@Injectable()
export class LogObserverService {
	private logs: LogEntry[] = [];
	private maxEntries: number = 10000;
	private currentId: number = 0;
	private originalStdoutWrite: any;
	private originalStderrWrite: any;
	private isObserving: boolean = false;

	constructor() {
		this.startObserving();
	}

	@bindThis
	private startObserving() {
		if (this.isObserving) return;

		this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
		this.originalStderrWrite = process.stderr.write.bind(process.stderr);

		process.stdout.write = (chunk: any, ...args: any[]) => {
			this.addLogEntry('stdout', chunk.toString());
			return this.originalStdoutWrite(chunk, ...args);
		};

		process.stderr.write = (chunk: any, ...args: any[]) => {
			this.addLogEntry('stderr', chunk.toString());
			return this.originalStderrWrite(chunk, ...args);
		};

		this.isObserving = true;
	}

	@bindThis
	private addLogEntry(type: 'stdout' | 'stderr', content: string) {
		const entry: LogEntry = {
			id: this.currentId++,
			timestamp: new Date().toISOString(),
			type,
			content: content.trim()
		};

		if (entry.content) {
			this.logs.push(entry);

			if (this.logs.length > this.maxEntries) {
				this.logs.shift();
			}
		}
	}

	@bindThis
	public getAllLogs(): LogEntry[] {
		return [...this.logs];
	}

	@bindThis
	public getRecentLogs(count: number = 100): LogEntry[] {
		return this.logs.slice(-count);
	}

	@bindThis
	public getLogsSince(sinceId: number): LogEntry[] {
		return this.logs.filter(log => log.id > sinceId);
	}

	@bindThis
	public getLogsInRange(startId: number, endId: number): LogEntry[] {
		return this.logs.filter(log => log.id >= startId && log.id <= endId);
	}

	@bindThis
	public clearLogs(): void {
		this.logs = [];
		this.currentId = 0;
	}

	@bindThis
	public getLogStats(): { totalCount: number; maxEntries: number; oldestId: number; newestId: number } {
		return {
			totalCount: this.logs.length,
			maxEntries: this.maxEntries,
			oldestId: this.logs.length > 0 ? this.logs[0].id : 0,
			newestId: this.logs.length > 0 ? this.logs[this.logs.length - 1].id : 0
		};
	}

	@bindThis
	public setMaxEntries(maxEntries: number): void {
		this.maxEntries = Math.max(1000, maxEntries);

		while (this.logs.length > this.maxEntries) {
			this.logs.shift();
		}
	}

	@bindThis
	public stopObserving(): void {
		if (!this.isObserving) return;

		process.stdout.write = this.originalStdoutWrite;
		process.stderr.write = this.originalStderrWrite;

		this.isObserving = false;
	}
}
