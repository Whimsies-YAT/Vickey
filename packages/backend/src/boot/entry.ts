/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Misskey Entry Point!
 */

import cluster from 'node:cluster';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import Xev from 'xev';
import Logger from '@/logger.js';
import { envOption } from '../env.js';
import { masterMain, spawnWorker } from './master.js';
import { workerMain } from './worker.js';
import { readyRef } from './ready.js';

import 'reflect-metadata';

process.title = `Vickey (${cluster.isPrimary ? 'master' : 'worker'})`;

Error.stackTraceLimit = Infinity;
EventEmitter.defaultMaxListeners = 128;

const logger = new Logger('core', 'cyan');
const clusterLogger = logger.createSubLogger('cluster', 'orange');
const ev = new Xev();

let isReloading = false;
let isShuttingDown = false;
const drainingWorkers = new Set<number>();

// Lock file path for graceful reload
const RELOAD_LOCK_FILE = path.join(os.tmpdir(), 'vickey-reload.lock');

//#region Events

// Listen new workers
cluster.on('fork', worker => {
	clusterLogger.debug(`Process forked: [${worker.id}]`);
});

// Listen online workers
cluster.on('online', worker => {
	clusterLogger.debug(`Process is now online: [${worker.id}]`);
});

// Listen for dying workers
cluster.on('exit', (worker, code, signal) => {
	const isDraining = drainingWorkers.has(worker.id);
	if (isDraining) {
		drainingWorkers.delete(worker.id);
		clusterLogger.info(`[${worker.id}] drained and exited (code: ${code}, signal: ${signal})`);
		return;
	}

	// Don't restart workers if we're shutting down
	if (isShuttingDown) {
		clusterLogger.info(`[${worker.id}] exited during shutdown (code: ${code}, signal: ${signal})`);
		return;
	}

	if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
		clusterLogger.info(`[${worker.id}] exited gracefully (code: ${code}, signal: ${signal})`);
	} else {
		// Replace the dead worker,
		// we're not sentimental
		clusterLogger.error(chalk.red(`[${worker.id}] died unexpectedly (code: ${code}, signal: ${signal}), restarting...`));
		cluster.fork();
	}
});

// Display detail of unhandled promise rejection
if (!envOption.quiet) {
	process.on('unhandledRejection', console.dir);
}

// Display detail of uncaught exception
process.on('uncaughtException', err => {
	try {
		logger.error(err);
		console.trace(err);
	} catch { }
});

// Dying away...
process.on('exit', code => {
	logger.info(`The process is going to exit with code ${code}`);
});

if (cluster.isPrimary) {
	const gracefulReload = async () => {
		if (envOption.disableClustering) {
			logger.warn('SIGHUP received, but clustering is disabled. Graceful reload is not available in single-process mode.');
			logger.info('To use graceful reload, start the server without MK_DISABLE_CLUSTERING environment variable.');
			return;
		}

		if (isReloading) {
			logger.warn('Reload already in progress, ignoring SIGHUP');
			return;
		}
		isReloading = true;

		try {
			fs.writeFileSync(RELOAD_LOCK_FILE, String(Date.now()), 'utf8');
		} catch (err) {
			logger.error('Failed to create reload lock file:', err as Error);
		}

		clusterLogger.info('SIGHUP received, starting graceful reload...');

		const oldWorkers = Object.values(cluster.workers ?? {}).filter((w): w is NonNullable<typeof w> => w != null);
		const workerCount = oldWorkers.length;

		if (workerCount === 0) {
			clusterLogger.warn('No workers to reload');
			isReloading = false;

			try {
				fs.unlinkSync(RELOAD_LOCK_FILE);
			} catch (err) {
			}
			return;
		}

		try {
			clusterLogger.info(`Spawning ${workerCount} new worker${workerCount === 1 ? '' : 's'}...`);
			await Promise.all([...Array(workerCount)].map(spawnWorker));
			clusterLogger.succ('New workers ready, traffic will now route to them');

			clusterLogger.info('Draining old workers...');
			for (const worker of oldWorkers) {
				drainingWorkers.add(worker.id);

				worker.disconnect();

				worker.kill('SIGTERM');

				setTimeout(() => {
					if (!worker.isDead()) {
						clusterLogger.warn(`Worker ${worker.id} still alive after 30s, force killing`);
						worker.kill('SIGKILL');
					}
				}, 30000);
			}

			clusterLogger.succ('Graceful reload completed - old workers draining');
		} catch (error) {
			logger.error('Error during graceful reload:', error as Error);
		} finally {
			isReloading = false;

			try {
				fs.unlinkSync(RELOAD_LOCK_FILE);
			} catch (err) {
			}
		}
	};

	const handleShutdownSignal = (signal: string) => {
		if (isShuttingDown) {
			logger.warn('Shutdown already in progress, forcing exit...');
			process.exit(1);
			return;
		}

		isShuttingDown = true;
		logger.info(`Master process received ${signal} signal, shutting down gracefully...`);

		const workers = Object.values(cluster.workers ?? {}).filter((w): w is NonNullable<typeof w> => w != null);

		for (const worker of workers) {
			drainingWorkers.add(worker.id);

			worker.disconnect();

			worker.kill('SIGTERM');

			setTimeout(() => {
				if (!worker.isDead()) {
					clusterLogger.warn(`Worker ${worker.id} still alive after 5s, force killing`);
					worker.kill('SIGKILL');
				}
			}, 5000);
		}

		setTimeout(() => {
			logger.info('Master process exiting...');
			process.exit(0);
		}, 6000);
	};

	process.on('SIGHUP', () => gracefulReload());
	process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
	process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
}

//#endregion

if (!envOption.disableClustering) {
	if (cluster.isPrimary) {
		logger.info(`Start main process... pid: ${process.pid}`);
		await masterMain();
		ev.mount();
	} else if (cluster.isWorker) {
		logger.info(`Start worker process... pid: ${process.pid}`);
		await workerMain();
	} else {
		throw new Error('Unknown process type');
	}
} else {
	// 非clusterの場合はMasterのみが起動するため、Workerの処理は行わない(cluster.isWorker === trueの状態でこのブロックに来ることはない)
	logger.info(`Start main process... pid: ${process.pid}`);
	await masterMain();
	ev.mount();
}

process.on('message', msg => {
	if (msg === 'gc') {
		if (global.gc != null) {
			logger.info('Manual GC triggered');
			global.gc();
			if (process.send != null) process.send('gc ok');
		} else {
			logger.warn('Manual GC requested but gc is not available. Start the process with --expose-gc to enable this feature.');
		}
	}
});

readyRef.value = true;

// ユニットテスト時にMisskeyが子プロセスで起動された時のため
// それ以外のときは process.send は使えないので弾く
if (process.send) {
	process.send('ok');
}
