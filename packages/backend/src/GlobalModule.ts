/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Global, Inject, Module } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import { MeiliSearch } from 'meilisearch';
import { MiMeta } from '@/models/Meta.js';
import { DI } from './di-symbols.js';
import { Config, loadConfig } from './config.js';
import { createPostgresDataSource } from './postgres.js';
import { RepositoryModule } from './models/RepositoryModule.js';
import { allSettled } from './misc/promise-tracker.js';
import { GlobalEvents } from './core/GlobalEventService.js';
import { LogObserverService } from './core/LogObserverService.js';
import type { Provider, OnApplicationShutdown } from '@nestjs/common';

const $config: Provider = {
	provide: DI.config,
	useValue: loadConfig(),
};

const $db: Provider = {
	provide: DI.db,
	useFactory: async (config) => {
		let retries = 0;
		const maxRetries = 5;
		const retryDelay = 3000;
		while (true) {
			try {
				const db = createPostgresDataSource(config);
				return await db.initialize();
			} catch (e) {
				retries++;
				console.error(`Failed to connect to database (attempt ${retries}/${maxRetries}):`, e);
				if (retries >= maxRetries) {
					throw e;
				}
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}
	},
	inject: [DI.config],
};

const $meilisearch: Provider = {
	provide: DI.meilisearch,
	useFactory: (config: Config) => {
		if (config.fulltextSearch?.provider === 'meilisearch') {
			if (!config.meilisearch) {
				throw new Error('MeiliSearch is enabled but no configuration is provided');
			}

			return new MeiliSearch({
				host: `${config.meilisearch.ssl ? 'https' : 'http'}://${config.meilisearch.host}:${config.meilisearch.port}`,
				apiKey: config.meilisearch.apiKey,
			});
		} else {
			return null;
		}
	},
	inject: [DI.config],
};

const $elasticsearch: Provider = {
	provide: DI.elasticsearch,
	useFactory: (config: Config) => {
		if (config.elasticsearch) {
			return new ElasticSearch({
				nodes: `${config.elasticsearch.ssl ? 'https' : 'http'}://${config.elasticsearch.host}:${config.elasticsearch.port}`,
				auth: {
					username: config.elasticsearch.user,
					password: config.elasticsearch.pass,
				},
				//headers: {'Content-Type': 'application/json'},
			});
		} else {
			return null;
		}
	},
	inject: [DI.config],
};

const redisRetryStrategy = (times: number) => {
	return Math.min(times * 50, 2000);
};

const $redis: Provider = {
	provide: DI.redis,
	useFactory: (config: Config) => {
		return new Redis.Redis({
			...config.redis,
			retryStrategy: redisRetryStrategy,
		});
	},
	inject: [DI.config],
};

const $redisForPub: Provider = {
	provide: DI.redisForPub,
	useFactory: (config: Config) => {
		const redis = new Redis.Redis({
			...config.redisForPubsub,
			retryStrategy: redisRetryStrategy,
		});
		return redis;
	},
	inject: [DI.config],
};

const $redisForSub: Provider = {
	provide: DI.redisForSub,
	useFactory: (config: Config) => {
		const redis = new Redis.Redis({
			...config.redisForPubsub,
			retryStrategy: redisRetryStrategy,
		});
		redis.subscribe(config.host);
		return redis;
	},
	inject: [DI.config],
};

const $redisForTimelines: Provider = {
	provide: DI.redisForTimelines,
	useFactory: (config: Config) => {
		return new Redis.Redis({
			...config.redisForTimelines,
			retryStrategy: redisRetryStrategy,
		});
	},
	inject: [DI.config],
};

const $redisForReactions: Provider = {
	provide: DI.redisForReactions,
	useFactory: (config: Config) => {
		return new Redis.Redis({
			...config.redisForReactions,
			retryStrategy: redisRetryStrategy,
		});
	},
	inject: [DI.config],
};

const $meta: Provider = {
	provide: DI.meta,
	useFactory: async (db: DataSource, redisForSub: Redis.Redis) => {
		const meta = await db.transaction(async transactionalEntityManager => {
			// 過去のバグでレコードが複数出来てしまっている可能性があるので新しいIDを優先する
			const metas = await transactionalEntityManager.find(MiMeta, {
				order: {
					id: 'DESC',
				},
			});

			const meta = metas[0];

			if (meta) {
				return meta;
			} else {
				// metaが空のときfetchMetaが同時に呼ばれるとここが同時に呼ばれてしまうことがあるのでフェイルセーフなupsertを使う
				const saved = await transactionalEntityManager
					.upsert(
						MiMeta,
						{
							id: 'x',
							abuseReportMLAction: 'none',
							abuseMLInfoUrl: '',
							abuseMLInfoToken: '',
							abuseMLInfoScore: 0.5,
						},
						['id'],
					)
					.then((x) => transactionalEntityManager.findOneByOrFail(MiMeta, x.identifiers[0]));

				return saved;
			}
		});

		async function onMessage(_: string, data: string): Promise<void> {
			const obj = JSON.parse(data);

			if (obj.channel === 'internal') {
				const { type, body } = obj.message as GlobalEvents['internal']['payload'];
				switch (type) {
					case 'metaUpdated': {
						for (const key in body.after) {
							(meta as any)[key] = (body.after as any)[key];
						}
						meta.rootUser = null; // joinなカラムは通常取ってこないので
						break;
					}
					default:
						break;
				}
			}
		}

		redisForSub.on('message', onMessage);

		return meta;
	},
	inject: [DI.db, DI.redisForSub],
};

@Global()
@Module({
	imports: [RepositoryModule],
	providers: [$config, $db, $meta, $meilisearch, $elasticsearch, $redis, $redisForPub, $redisForSub, $redisForTimelines, $redisForReactions, LogObserverService],
	exports: [$config, $db, $meta, $meilisearch, $elasticsearch, $redis, $redisForPub, $redisForSub, $redisForTimelines, $redisForReactions, RepositoryModule, LogObserverService],
})
export class GlobalModule implements OnApplicationShutdown {
	private disposed = false;

	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redisClient: Redis.Redis,
		@Inject(DI.redisForPub) private redisForPub: Redis.Redis,
		@Inject(DI.redisForSub) private redisForSub: Redis.Redis,
		@Inject(DI.redisForTimelines) private redisForTimelines: Redis.Redis,
		@Inject(DI.redisForReactions) private redisForReactions: Redis.Redis,
		private logObserverService: LogObserverService,
	) {
		// LogObserverService is automatically initialized and starts observing
		// when it's injected, so no additional setup needed
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		try {
			// Wait for all potential DB queries
			await allSettled();
			// And then disconnect from DB
			await Promise.all([
				this.db.destroy(),
				this.redisClient.disconnect(),
				this.redisForPub.disconnect(),
				this.redisForSub.disconnect(),
				this.redisForTimelines.disconnect(),
				this.redisForReactions.disconnect(),
			]);
		} catch (err) {
			console.error('Error when closing database connection:', err);
		}
	}

	async onApplicationShutdown(signal: string): Promise<void> {
		await this.dispose();
	}
}
