/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { NestFactory } from '@nestjs/core';
import { init } from 'slacc';
import { NestLogger } from '@/NestLogger.js';
import { loadConfig, Config } from '@/config.js';
import { CacheService } from '@/core/CacheService.js';

let slaccInitialized = false;

export function initExtraThreadPool(config: Config) {
	if (slaccInitialized) return;

	const threadPoolSize = Math.max(config.threadPoolSize ?? 1, 1);

	init(threadPoolSize);

	slaccInitialized = true;
}

export async function server() {
	const { MainModule } = await import('../MainModule.js');
	const { ServerService } = await import('../server/ServerService.js');

	const app = await NestFactory.createApplicationContext(MainModule, {
		logger: new NestLogger(),
		abortOnError: false,
	});

	const serverService = app.get(ServerService);
	await serverService.launch();

	if (process.env.NODE_ENV !== 'test') {
		const { ChartManagementService } = await import('../core/chart/ChartManagementService.js');
		const { QueueStatsService } = await import('../daemons/QueueStatsService.js');
		const { ServerStatsService } = await import('../daemons/ServerStatsService.js');

		app.get(ChartManagementService).start();
		app.get(QueueStatsService).start();
		app.get(ServerStatsService).start();
	}

	const closeAppSafely = async (app: any, reason?: string) => {
		if (reason) console.log(reason);

		try {
			const cacheService = app.get(CacheService);
			if (cacheService && typeof cacheService.beforeApplicationShutdown === 'function') {
				await cacheService.beforeApplicationShutdown();
			}

			const serverService = app.get(ServerService);
			await serverService.dispose();

			await app.close();
			console.log('Application closed successfully');
			process.exit(0);
		} catch (err) {
			console.error('Error when closing application:', err);
			process.exit(1);
		}
	};

	let config: Config | null = loadConfig();
	if ((!config.tokenSalt || config.tokenSalt === "ThisIsNOTSecureEnoughChangeItPoweredByVickey") || (!config.hmacKey || config.hmacKey === "ThisIsNOTSecureEnoughChangeItPoweredByVickey")) {
		await closeAppSafely(app, 'Token salt missing or unsafe, closing application...');
	}

	config = null;

	const handleSignal = async (signal: string) => {
		await closeAppSafely(app, `Received ${signal} signal, closing application...`);
	};

	process.on('SIGINT', () => handleSignal('SIGINT'));
	process.on('SIGTERM', () => handleSignal('SIGTERM'));
	process.on('SIGHUP', () => handleSignal('SIGHUP'));

	return app;
}

export async function jobQueue() {
	const { QueueProcessorModule } = await import('../queue/QueueProcessorModule.js');
	const { QueueProcessorService } = await import('../queue/QueueProcessorService.js');
	const { ChartManagementService } = await import('../core/chart/ChartManagementService.js');

	const jobQueue = await NestFactory.createApplicationContext(QueueProcessorModule, {
		logger: new NestLogger(),
		abortOnError: false,
	});

	jobQueue.get(QueueProcessorService).start();
	jobQueue.get(ChartManagementService).start();

	const handleSignal = async (signal: string) => {
		console.log(`Received ${signal} signal, closing job queue...`);

		try {
			const queueProcessor = jobQueue.get(QueueProcessorService);
			if (typeof queueProcessor.stop === 'function') {
				await queueProcessor.stop();
			}

			await jobQueue.close();
			console.log('Job queue closed successfully');

			process.exit(0);
		} catch (err) {
			console.error('Error when closing job queue:', err);
			process.exit(1);
		}
	};

	process.on('SIGINT', () => handleSignal('SIGINT'));
	process.on('SIGTERM', () => handleSignal('SIGTERM'));
	process.on('SIGHUP', () => handleSignal('SIGHUP'));

	return jobQueue;
}
