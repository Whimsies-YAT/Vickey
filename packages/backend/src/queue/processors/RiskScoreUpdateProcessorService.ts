/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type Logger from '@/logger.js';

export interface RiskUpdateJob {
	type: 'single_user' | 'baseline_update';
	userId?: string;
}

@Injectable()
export class RiskScoreUpdateProcessorService {
	private logger: Logger;

	constructor(
		private userRiskScoreService: UserRiskScoreService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('risk-score-update');
	}

	@bindThis
	public async process(job: Bull.Job<RiskUpdateJob>): Promise<void> {
		const { type, userId } = job.data;

		switch (type) {
			case 'single_user':
				if (userId) {
					await this.updateSingleUser(userId);
				}
				break;
			case 'baseline_update':
				try {
					await (this.userRiskScoreService as any).updateBaselines();
					this.logger.info('Updated risk score baselines');
				} catch (e) {
					const err = e as Error;
					this.logger.error('Failed to update baselines:', err);
					throw err;
				}
				break;
		}
	}

	@bindThis
	private async updateSingleUser(userId: string): Promise<void> {
		try {
			const riskScore = await this.userRiskScoreService.calculateUserRiskScore(userId);
			this.logger.debug(`Updated risk score for user ${userId}: ${riskScore.totalScore} (${riskScore.riskLevel})`);
		} catch (e) {
			const err = e as Error;
			this.logger.error(`Failed to update risk score for user ${userId}:`, err);
			throw err;
		}
	}
}
