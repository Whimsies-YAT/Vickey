/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { MiMeta } from '@/models/Meta.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { CacheService } from '@/core/CacheService.js';
import { bindThis } from '@/decorators.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import { FeaturedService } from '@/core/FeaturedService.js';
import type { OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class MetaService implements OnApplicationShutdown {
	private cache: MiMeta | undefined;
	private intervalId: NodeJS.Timeout;

	constructor(
		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private featuredService: FeaturedService,
		private globalEventService: GlobalEventService,
		private cacheService: CacheService,
	) {
		//this.onMessage = this.onMessage.bind(this);

		if (process.env.NODE_ENV !== 'test') {
			this.intervalId = setInterval(() => {
				this.fetch(true).then(meta => {
					// fetch内でもセットしてるけど仕様変更の可能性もあるため一応
					this.cache = meta;
				});
			}, 1000 * 60 * 5);
		}

		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);

		if (obj.channel === 'internal') {
			const { type, body } = obj.message as GlobalEvents['internal']['payload'];
			switch (type) {
				case 'metaUpdated': {
					this.cache = { // TODO: このあたりのデシリアライズ処理は各modelファイル内に関数としてexportしたい
						...(body.after),
						proxyAccount: null, // joinなカラムは通常取ってこないので
					};
					break;
				}
				default:
					break;
			}
		}
	}

	@bindThis
	public async fetch(noCache = false): Promise<MiMeta> {
		if (!noCache && this.cache) return this.cache;

		return await this.db.transaction(async transactionalEntityManager => {
			// 過去のバグでレコードが複数出来てしまっている可能性があるので新しいIDを優先する
			const metas = await transactionalEntityManager.find(MiMeta, {
				order: {
					id: 'DESC',
				},
			});

			const metaBF = metas[0];
			const beforeSec = await this.cacheService.systemStatusCache.fetch('systemStatus');
			const meta = { ...metaBF, security: beforeSec.security };

			if (meta) {
				this.cache = meta;
				return meta;
			} else {
				// metaが空のときfetchMetaが同時に呼ばれるとここが同時に呼ばれてしまうことがあるのでフェイルセーフなupsertを使う
				const saved = await transactionalEntityManager
					.upsert(
						MiMeta,
						{
							id: 'x',
						},
						['id'],
					)
					.then((x) => transactionalEntityManager.findOneByOrFail(MiMeta, x.identifiers[0]));

				this.cache = saved;
				return saved;
			}
		});
	}

	@bindThis
	public async update(data: Partial<MiMeta>): Promise<MiMeta | undefined> {
		await this.cacheService.systemStatusCache.refresh('systemStatus');
		const beforeSec = await this.cacheService.systemStatusCache.fetch('systemStatus');
		const { security = beforeSec.security, ...restDataBF } = data;
		const restData = { ...restDataBF, security: true };

		let before: MiMeta | undefined;

		const updated = await this.db.transaction(async transactionalEntityManager => {
			const metas = await transactionalEntityManager.find(MiMeta, {
				order: {
					id: 'DESC',
				},
			});

			before = metas[0];

			if (security !== undefined) {
				if (beforeSec.security !== security) {
					await this.redisClient.set('systemStatus', JSON.stringify({ security: security }));
					await this.cacheService.systemStatusCache.refresh('systemStatus');
				}
			}

			if (before) {
				await transactionalEntityManager.update(MiMeta, before.id, restData);

				const metas = await transactionalEntityManager.find(MiMeta, {
					order: {
						id: 'DESC',
					},
				});

				return metas[0];
			} else {
				return await transactionalEntityManager.save(MiMeta, restData);
			}
		});

		if (restData.hiddenTags) {
			process.nextTick(() => {
				const hiddenTags = new Set<string>(restData.hiddenTags);
				if (before) {
					for (const previousHiddenTag of before.hiddenTags) {
						hiddenTags.delete(previousHiddenTag);
					}
				}

				for (const hiddenTag of hiddenTags) {
					this.featuredService.removeHashtagsFromRanking(hiddenTag);
				}
			});
		}

		const finallyBefore: MiMeta = { ...(before as MiMeta), security: beforeSec.security };
		const finallyUpd: MiMeta = { ...(updated as MiMeta), security: security };

		this.globalEventService.publishInternalEvent('metaUpdated', { before: finallyBefore, after: finallyUpd });

		return finallyUpd;
	}

	@bindThis
	public dispose(): void {
		clearInterval(this.intervalId);
		this.redisForSub.off('message', this.onMessage);
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
