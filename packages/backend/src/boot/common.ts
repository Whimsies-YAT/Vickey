/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { NestFactory } from '@nestjs/core';
import { ChartManagementService } from '@/core/chart/ChartManagementService.js';
import { QueueProcessorService } from '@/queue/QueueProcessorService.js';
import { NestLogger } from '@/NestLogger.js';
import { QueueProcessorModule } from '@/queue/QueueProcessorModule.js';
import { QueueStatsService } from '@/daemons/QueueStatsService.js';
import { ServerStatsService } from '@/daemons/ServerStatsService.js';
import { ServerService } from '@/server/ServerService.js';
import { MainModule } from '@/MainModule.js';

export async function server() {
	const app = await NestFactory.createApplicationContext(MainModule, {
		logger: new NestLogger(),
		abortOnError: false,
	});

	const serverService = app.get(ServerService);
	await serverService.launch();

	if (process.env.NODE_ENV !== 'test') {
		app.get(ChartManagementService).start();
		app.get(QueueStatsService).start();
		app.get(ServerStatsService).start();
	}

	const handleSignal = async (signal: string) => {
		console.log(`Received ${signal} signal, closing application...`);

		try {
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

	process.on('SIGINT', () => handleSignal('SIGINT'));
	process.on('SIGTERM', () => handleSignal('SIGTERM'));
	process.on('SIGHUP', () => handleSignal('SIGHUP'));

	return app;
}

export async function jobQueue() {
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
