/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class UserSessionsProcessorService {
	private logger: Logger;
	constructor(
		private userSessionsService: UserSessionsService,
		private queueLoggerService: QueueLoggerService
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('syncSessions');
	}

	@bindThis
	public async process(): Promise<void> {
		this.logger.info('Processing user sessions...');
		await this.userSessionsService.syncTokenCacheWithDatabase();
		this.logger.succ('Done.');
	}
}
