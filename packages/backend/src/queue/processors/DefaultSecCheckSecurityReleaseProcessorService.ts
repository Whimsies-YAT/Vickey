/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { MetaService } from '@/core/MetaService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class DefaultSecCheckSecurityReleaseProcessorService {
	private logger: Logger;
	constructor(
		private metaService: MetaService,
		private queueLoggerService: QueueLoggerService
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('default-sec');
	}

	@bindThis
	public async process(): Promise<void> {
		this.logger.info('Set Default Security...');
		const set = { security: true } as Partial<MiMeta>;
		await this.metaService.update(set);
		this.logger.succ('Done.');
	}
}
