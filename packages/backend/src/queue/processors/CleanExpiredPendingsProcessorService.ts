/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {Inject, Injectable} from '@nestjs/common';
import type Logger from '@/logger.js';
import type { UserPendingsRepository, MiMeta } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { bindThis } from '@/decorators.js';
import { DI } from "@/di-symbols.js";

@Injectable()
export class CleanExpiredPendingsProcessorService {
	private logger: Logger;
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		private idService: IdService,
		private queueLoggerService: QueueLoggerService
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('clean-pending');
	}

	@bindThis
	public async process(): Promise<void> {

		if (!this.meta.emailRequiredForSignup) {
			this.logger.info(`Nothing to do.`);
			return;
		}

		const CheckData = await this.userPendingsRepository.findBy({ emailVerified: false });

		if (CheckData.length === 0) {
			this.logger.info(`Nothing to do.`);
			return;
		}

		for (const pending of CheckData) {
			if (pending.email && this.idService.parse(pending.id).date.getTime() + (1000 * 60 * 30) < Date.now()) {
				try {
					this.logger.info(`Deleting ${ pending.id }...`);
					await this.userPendingsRepository.delete({
						id: pending.id,
					});
				} catch (e) {
					this.logger.error(`Failed to delete ${ pending.id }: ${ e instanceof Error ? e.message : e }`);
				}
			}
		}
	}
}
