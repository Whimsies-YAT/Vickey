/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { OfflineGeocodingService } from '../../src/core/OfflineGeocodingService.js';
import { LoggerService } from '../../src/core/LoggerService.js';
import { HttpRequestService } from '../../src/core/HttpRequestService.js';
import { DownloadService } from '../../src/core/DownloadService.js';
import { Config } from '../../src/config.js';

const mockConfig = {
	offlineGeocoding: {
		downloadFullGeoNames: false,
		includeAlternateNames: false,
		downloadOSM: false,
	},
	elasticsearch: undefined,
} as unknown as Config;

const mockLoggerService = {
	getLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
} as unknown as LoggerService;

const mockHttpRequestService = {} as unknown as HttpRequestService;
const mockDownloadService = {} as unknown as DownloadService;

describe('OfflineGeocodingService Performance', () => {
	let service: OfflineGeocodingService;

	beforeAll(async () => {
		service = new OfflineGeocodingService(
			mockConfig,
			mockLoggerService,
			mockHttpRequestService,
			mockDownloadService,
		);

		const entries = [];
		for (let i = 0; i < 100000; i++) {
			entries.push({
				lat: 35.6895 + (Math.random() - 0.5) * 10,
				lon: 139.6917 + (Math.random() - 0.5) * 10,
				properties: { name: `Place ${i}`, city: 'Tokyo' },
				level: 'city',
				importance: Math.random(),
				place_id: i,
				osm_id: i,
				hash: `hash_${i}`,
			});
		}

		(service as any).geoData = entries;

		console.time('buildSpatialIndex');
		await (service as any).buildSpatialIndex();
		(service as any).isInitialized = true;
	});

	test('should find candidates quickly using Rust index', async () => {
		const query = { lat: 35.6895, lon: 139.6917, radius: 50 };

		const start = performance.now();
		const generator = service.streamGeocodingResults(query, { pageSize: 100 });

		let count = 0;
		for await (const batch of generator) {
			count += batch.length;
			if (count >= 100) break;
		}
		const end = performance.now();

		console.log(`Search took ${end - start}ms for ${count} results`);

		expect(count).toBeGreaterThan(0);
		expect(end - start).toBeLessThan(100); // Should be very fast
	});
});
