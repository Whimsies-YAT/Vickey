/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { CheckSecurityUpdateService } from '@/core/CheckSecurityUpdateService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class CheckSecurityReleaseProcessorService{
	private logger: Logger;
	constructor(
		private checkSecurityUpdateService: CheckSecurityUpdateService,
		private queueLoggerService: QueueLoggerService
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('check-version');
	}

	@bindThis
	public async process(): Promise<void> {
		this.logger.info('Checking version...');
		await Promise.all([
			this.checkSecurityUpdateService.checkSecUpdate(),
		]);
		this.logger.succ('Done.');
	}
}
