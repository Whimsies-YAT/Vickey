/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {Inject, Injectable} from '@nestjs/common';
import type Logger from '@/logger.js';
import { IP2LocationService } from '@/core/IP2LocationService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import { DI } from "@/di-symbols.js";

@Injectable()
export class CheckIP2LReleaseProcessorService {
	private logger: Logger;
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private iP2LocationService: IP2LocationService,
		private queueLoggerService: QueueLoggerService
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('check-ip2l-release');
	}

	@bindThis
	public async process(): Promise<void> {
		this.logger.info('Checking version...');
		const key = 'ip2l';
		const value = 'latest';
		if (!this.redisClient.get(key)) {
			await this.storeData(key, value);
			await Promise.all([
				this.iP2LocationService.syncIP2L(),
			]);
		}
		this.logger.succ('Done.');
	}

	private async storeData(key: string, value: string) {
		await this.redisClient.set(key, value, 'EX', 259200);
	}
}
