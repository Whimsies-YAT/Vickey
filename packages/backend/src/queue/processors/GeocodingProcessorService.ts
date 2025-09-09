/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { OfflineGeocodingService } from '@/core/OfflineGeocodingService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';
import type { GeocodingJobData } from '../types.js';

@Injectable()
export class GeocodingProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private offlineGeocodingService: OfflineGeocodingService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('geocoding');
	}

	@bindThis
	public async process(job: Bull.Job<GeocodingJobData>): Promise<any> {
		this.logger.info(`Processing geocoding job: ${job.data.jobType}`);

		try {
			switch (job.data.jobType) {
				case 'syncOfflineGeoData':
					return await this.offlineGeocodingService.syncOfflineGeoData();

				case 'precomputeHotSpots':
					if (!job.data.hotSpots) {
						throw new Error('hotSpots are required for precomputeHotSpots job');
					}
					return await this.offlineGeocodingService.precomputeHotSpots(job.data.hotSpots);

				case 'performIncrementalUpdate':
					return await this.offlineGeocodingService.performIncrementalUpdate();

				default:
					throw new Error(`Unknown geocoding job type: ${(job.data as any).jobType}`);
			}
		} catch (error) {
			this.logger.error(`Failed to process geocoding job: ${job.data.jobType}`, { error: (error as Error).message });
			throw error;
		}
	}
}
