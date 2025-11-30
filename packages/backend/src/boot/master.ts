/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as os from 'node:os';
import cluster from 'node:cluster';
import chalk from 'chalk';
import chalkTemplate from 'chalk-template';
import Logger from '@/logger.js';
import { loadConfig, updateGlobalConfig } from '@/config.js';
import type { Config } from '@/config.js';
import { showMachineInfo } from '@/misc/show-machine-info.js';
import { envOption } from '@/env.js';
import { jobQueue, server } from './common.js';
import * as argon2 from '@node-rs/argon2';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const meta = JSON.parse(fs.readFileSync(`${_dirname}/../../../../built/meta.json`, 'utf-8'));

const logger = new Logger('core', 'cyan');
const bootLogger = logger.createSubLogger('boot', 'magenta');

// Global Argon2id configuration
export let globalArgon2Config = {
	memoryCost: 4096,
	timeCost: 3,
	parallelism: 1,
};

// Global autotune promise - started early, awaited later
let autotunePromise: Promise<void> | null = null;

const themeColor = chalk.hex('#86b300');

function greet() {
	if (!envOption.quiet) {
		//#region Vickey logo
		const v = `${meta.codename} v${meta.version}`;
		console.log(themeColor(' __     ___      _                   '));
		console.log(themeColor(' \\ \\   / (_) ___| | _____ _   _    '));
		console.log(themeColor('  \\ \\ / /| |/ __| |/ / _ \\ | | |  '));
		console.log(themeColor('   \\ V / | | (__|   <  __/ |_| |    '));
		console.log(themeColor('    \\_/  |_|\\___|_|\\_\\___|\\__, |'));
		console.log(themeColor('                          |___/      '));
		console.log(' ' + chalk.gray(v) + themeColor('                         \n'.substring(v.length)));
		//#endregion

		console.log(' Vickey Inspires Connection, Keeping Everyone Yours!');
		console.log(chalk.rgb(255, 136, 0)(' If you like Vickey, please consider donating to support dev. https://ko-fi.com/yateam'));

		console.log('');
		console.log(chalkTemplate`--- ${os.hostname()} {gray (PID: ${process.pid.toString()})} ---`);
	}

	bootLogger.info('Welcome to Vickey!');
	bootLogger.info(`Vickey ${meta.codename} v${meta.version}`, null, true);
}

/**
 * Init master process
 */
export async function masterMain() {
	let config!: Config;

	// initialize app
	try {
		greet();
		showEnvironment();
		await showMachineInfo(bootLogger);
		showNodejsVersion();
		config = loadConfigBoot();

		// Start Argon2id autotune in background immediately after config load
		autotunePromise = performArgon2Autotune();

		//await connectDb();
		if (config.pidFile) fs.writeFileSync(config.pidFile, process.pid.toString());
	} catch (e) {
		bootLogger.error('Fatal error occurred during initialization', null, true);
		process.exit(1);
	}

	bootLogger.succ('Vickey initialized');

	if (config.sentryForBackend) {
		const Sentry = await import('@sentry/node');
		const { nodeProfilingIntegration } = await import('@sentry/profiling-node');

		Sentry.init({
			integrations: [
				...(config.sentryForBackend.enableNodeProfiling ? [nodeProfilingIntegration()] : []),
			],

			// Performance Monitoring
			tracesSampleRate: 1.0, //  Capture 100% of the transactions

			// Set sampling rate for profiling - this is relative to tracesSampleRate
			profileSessionSampleRate: 1.0,

			maxBreadcrumbs: 0,

			...config.sentryForBackend.options,
		});
	}

	bootLogger.info(
		`mode: [disableClustering: ${envOption.disableClustering}, onlyServer: ${envOption.onlyServer}, onlyQueue: ${envOption.onlyQueue}]`,
	);

	// Wait for Argon2id autotune to complete before starting services
	if (autotunePromise !== null) {
		await autotunePromise;
	}

	if (!envOption.disableClustering) {
		// clusterモジュール有効時
		// Master process only manages workers in default mode

		if (envOption.onlyServer) {
			// onlyServer かつ enableCluster な場合、メインプロセスはforkのみに制限する(listenしない)。
			// ワーカープロセス側でlistenすると、メインプロセスでポートへの着信を受け入れてワーカープロセスへの分配を行う動作をする。
			// そのため、メインプロセスでも直接listenするとポートの競合が発生して起動に失敗してしまう。
			// see: https://nodejs.org/api/cluster.html#cluster
		} else if (envOption.onlyQueue) {
			await jobQueue();
		}
		await spawnWorkers(config.clusterLimit);
	} else {
		// clusterモジュール無効時

		if (envOption.onlyServer) {
			await server();
		} else if (envOption.onlyQueue) {
			await jobQueue();
		} else {
			await server();
			await jobQueue();
		}
	}

	if (envOption.onlyQueue) {
		bootLogger.succ('Queue started', null, true);
	} else {
		bootLogger.succ(config.socket ? `Now listening on socket ${config.socket} on ${config.url}` : `Now listening on port ${config.port} on ${config.url}`, null, true);
	}
}

function showEnvironment(): void {
	const env = process.env.NODE_ENV;
	const logger = bootLogger.createSubLogger('env');
	logger.info(typeof env === 'undefined' ? 'NODE_ENV is not set' : `NODE_ENV: ${env}`);

	if (env !== 'production') {
		logger.warn('The environment is not in production mode.');
		logger.warn('DO NOT USE FOR PRODUCTION PURPOSE!', null, true);
	}
}

function showNodejsVersion(): void {
	const nodejsLogger = bootLogger.createSubLogger('nodejs');

	nodejsLogger.info(`Version ${process.version} detected.`);
}

function loadConfigBoot(): Config {
	const configLogger = bootLogger.createSubLogger('config');
	let config;

	try {
		config = loadConfig();
	} catch (exception) {
		if (typeof exception === 'string') {
			configLogger.error(exception);
			process.exit(1);
		} else if ((exception as any).code === 'ENOENT') {
			configLogger.error('Configuration file not found', null, true);
			process.exit(1);
		}
		throw exception;
	}

	configLogger.succ('Loaded');

	return config;
}

/*
async function connectDb(): Promise<void> {
	const dbLogger = bootLogger.createSubLogger('db');

	// Try to connect to DB
	try {
		dbLogger.info('Connecting...');
		await initDb();
		const v = await db.query('SHOW server_version').then(x => x[0].server_version);
		dbLogger.succ(`Connected: v${v}`);
	} catch (err) {
		dbLogger.error('Cannot connect', null, true);
		dbLogger.error(err);
		process.exit(1);
	}
}
*/

async function spawnWorkers(limit = 1) {
	const workers = Math.min(limit, os.cpus().length);
	bootLogger.info(`Starting ${workers} worker${workers === 1 ? '' : 's'}...`);
	await Promise.all([...Array(workers)].map(spawnWorker));
	bootLogger.succ('All workers started');
}

export function spawnWorker(): Promise<void> {
	return new Promise(res => {
		const worker = cluster.fork();
		worker.on('message', message => {
			if (message === 'listenFailed') {
				bootLogger.error('The server Listen failed due to the previous error.');
				process.exit(1);
			}
			if (message !== 'ready') return;
			res();
		});
	});
}

/**
 * Perform Argon2id dynamic autotune
 */
async function performArgon2Autotune() {
	const argonLogger = bootLogger.createSubLogger('argon2', 'yellow');
	argonLogger.info('Starting Argon2id autotune...');

	const targetTime = 100; // Target 100ms
	const testPassword = 'test-password-for-autotune-benchmarking';
	const availableCpus = os.cpus().length;

	// Start with baseline parameters
	let bestConfig = {
		memoryCost: 4096,
		timeCost: 3,
		parallelism: Math.min(2, availableCpus),
	};

	let bestTime = await benchmarkArgon2Config(testPassword, bestConfig);
	argonLogger.info(`Initial benchmark: ${bestTime.toFixed(1)}ms`);

	// Binary search for memory cost
	let memoryMin = 1024;
	let memoryMax = 65536;

	while (memoryMax - memoryMin > 512) {
		const memoryMid = Math.floor((memoryMin + memoryMax) / 2);

		const testConfig = {
			...bestConfig,
			memoryCost: memoryMid,
		};

		const testTime = await benchmarkArgon2Config(testPassword, testConfig);

		if (testTime <= targetTime) {
			memoryMin = memoryMid;
			if (testTime > bestTime && testTime <= targetTime) {
				bestConfig = { ...testConfig };
				bestTime = testTime;
			}
		} else {
			memoryMax = memoryMid;
		}
	}

	// Fine-tune time cost
	for (let timeCost = 1; timeCost <= 8; timeCost++) {
		const testConfig = {
			...bestConfig,
			timeCost,
		};

		const testTime = await benchmarkArgon2Config(testPassword, testConfig);

		if (testTime <= targetTime) {
			if (testTime > bestTime) {
				bestConfig = { ...testConfig };
				bestTime = testTime;
			}
		} else {
			break;
		}
	}

	// Optimize parallelism
	const maxParallelism = Math.min(availableCpus, 6);
	for (let parallelism = 1; parallelism <= maxParallelism; parallelism++) {
		const testConfig = {
			...bestConfig,
			parallelism,
		};

		const testTime = await benchmarkArgon2Config(testPassword, testConfig);

		if (testTime <= targetTime && testTime < bestTime) {
			bestConfig = { ...testConfig };
			bestTime = testTime;
		}
	}

	// Final validation with multiple runs
	const finalTime = await benchmarkArgon2ConfigMultiple(testPassword, bestConfig, 3);

	// Update global config
	globalArgon2Config = bestConfig;

	// Update the global config object so other parts of the app can access it
	updateGlobalConfig({ argon2Config: bestConfig });

	argonLogger.succ(`Autotune completed: memory=${bestConfig.memoryCost}KiB, time=${bestConfig.timeCost}, parallelism=${bestConfig.parallelism}, avg=${finalTime.toFixed(1)}ms`);
}

async function benchmarkArgon2Config(password: string, config: typeof globalArgon2Config): Promise<number> {
	const start = process.hrtime.bigint();

	try {
		await argon2.hash(password, {
			memoryCost: config.memoryCost,
			timeCost: config.timeCost,
			parallelism: config.parallelism,
			outputLen: 32,
		});

		const end = process.hrtime.bigint();
		return Number(end - start) / 1_000_000; // Convert to milliseconds
	} catch (error) {
		return Infinity;
	}
}

async function benchmarkArgon2ConfigMultiple(password: string, config: typeof globalArgon2Config, runs: number): Promise<number> {
	const times: number[] = [];

	for (let i = 0; i < runs; i++) {
		const time = await benchmarkArgon2Config(password, config);
		if (time !== Infinity) {
			times.push(time);
		}
	}

	return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : Infinity;
}
