/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { LoggerService } from '@/core/LoggerService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { DownloadService } from '@/core/DownloadService.js';
import * as zlib from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';

interface GeocodingResult {
	type: 'FeatureCollection';
	features: Array<{
		type: 'Feature';
		properties: {
			name?: string;
			display_name?: string;
			city?: string;
			town?: string;
			village?: string;
			county?: string;
			state?: string;
			state_district?: string;
			country?: string;
			country_code?: string;
			postcode?: string;
			road?: string;
			house_number?: string;
			district?: string;
			suburb?: string;
			neighbourhood?: string;
		};
		geometry: {
			type: 'Point';
			coordinates: [number, number];
		};
	}>;
}

interface GeoDataEntry {
	lat: number;
	lon: number;
	bounds?: [number, number, number, number];
	properties: any;
	level: 'city' | 'town' | 'village' | 'district' | 'county' | 'state' | 'country';
	population?: number;
	area?: number;
	importance: number;
	place_id: number;
	osm_id: number;
	hash: string;
}

@Injectable()
export class OfflineGeocodingService implements OnApplicationShutdown {
	private geoData: GeoDataEntry[] = [];
	private spatialIndex: Map<string, GeoDataEntry[]> = new Map();
	private hierarchicalIndex = new Map<string, Map<string, Map<string, Map<string, GeoDataEntry[]>>>>();
	private cache = new Map<string, { result: GeocodingResult, timestamp: number }>();
	private precomputedResults = new Map<string, GeocodingResult>();
	private isInitialized = false;
	private readonly GRID_SIZE = 0.01;
	private readonly CACHE_TTL = 300000;
	private readonly MAX_CACHE_SIZE = 100000;

	private readonly NETWORK_TIMEOUT = 30000;
	private readonly MAX_RETRIES = 3;
	private readonly RETRY_DELAY_BASE = 1000;
	private readonly STREAM_CHUNK_SIZE = 1024 * 1024;
	private readonly MAX_MEMORY_USAGE = 512 * 1024 * 1024;

	private readonly MIN_VALID_LAT = -90;
	private readonly MAX_VALID_LAT = 90;
	private readonly MIN_VALID_LON = -180;
	private readonly MAX_VALID_LON = 180;
	private readonly MIN_IMPORTANCE = 0;
	private readonly MAX_IMPORTANCE = 1;
	private readonly MAX_NAME_LENGTH = 500;
	private readonly SUSPICIOUS_COORDINATE_THRESHOLD = 0.000001;
	private readonly GRID_LEVELS = [
		{ size: 1.0, name: 'L1' },
		{ size: 0.1, name: 'L2' },
		{ size: 0.01, name: 'L3' },
		{ size: 0.001, name: 'L4' }
	];
	private gridStats = new Map<string, number>();
	private dataQualityStats = {
		totalProcessed: 0,
		validEntries: 0,
		invalidCoordinates: 0,
		invalidNames: 0,
		duplicates: 0,
		suspiciousData: 0
	};
	private networkRetryStats = new Map<string, number>();
	private readonly dataPath: string;
	private readonly syncDataPath: string;
	private readonly elasticClient?: ElasticSearch;
	private readonly logger;
	private workerPool: Worker[] = [];
	private syncInProgress = false;
	private readonly ES_INDEX_PREFIX = 'geocoding';
	private readonly OSM_DATA_SOURCES = {
		allCountries: 'https://download.geonames.org/export/dump/allCountries.zip',
		alternateNames: 'https://download.geonames.org/export/dump/alternateNames.zip',
		admin1Codes: 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
		admin2Codes: 'https://download.geonames.org/export/dump/admin2Codes.txt',
		countryInfo: 'https://download.geonames.org/export/dump/countryInfo.txt',
		hierarchy: 'https://download.geonames.org/export/dump/hierarchy.zip',

		cities15000: 'https://download.geonames.org/export/dump/cities15000.zip',
		cities5000: 'https://download.geonames.org/export/dump/cities5000.zip',
		cities1000: 'https://download.geonames.org/export/dump/cities1000.zip',
		cities500: 'https://download.geonames.org/export/dump/cities500.zip',

		planet: 'https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf',
		asia: 'https://download.geofabrik.de/asia-latest.osm.pbf',
		china: 'https://download.geofabrik.de/asia/china-latest.osm.pbf',

		changesets: 'https://planet.openstreetmap.org/replication/changesets/',
		minutely: 'https://planet.openstreetmap.org/replication/minute/',
		hourly: 'https://planet.openstreetmap.org/replication/hour/',
		daily: 'https://planet.openstreetmap.org/replication/day/',
	};
	private currentDataVersion = 0;
	private readonly BATCH_SIZE = 10000;
	private readonly CONCURRENT_SEARCH_LIMIT = 100;

	private readonly BINARY_FORMAT_VERSION = 1;
	private readonly COMPRESS_THRESHOLD = 1000000;
	private readonly SHARD_SIZE = 500000;

	constructor(
		@Inject(DI.config)
		private config: Config,

		loggerService: LoggerService,
		private httpRequestService: HttpRequestService,
		private downloadService: DownloadService,
	) {
		this.logger = loggerService.getLogger('geocoding');
		const projectRoot = process.cwd();
		const filesDir = path.join(projectRoot, 'files');
		this.dataPath = path.join(filesDir, 'geoData');
		this.syncDataPath = path.join(filesDir, 'geoData-sync');

		if (this.config.elasticsearch) {
			this.elasticClient = new ElasticSearch({
				node: `${this.config.elasticsearch.ssl ? 'https' : 'http'}://${this.config.elasticsearch.host}:${this.config.elasticsearch.port}`,
				auth: {
					username: this.config.elasticsearch.user,
					password: this.config.elasticsearch.pass,
				},
			});
		}

		this.ensureAllDirectories().catch(error => {
			this.logger.warn('Failed to initialize directories, will create on demand:', error);
		});
	}

	@bindThis
	private async ensureDataDirectory(): Promise<void> {
		try {
			await fs.access(this.dataPath);
		} catch {
			await fs.mkdir(this.dataPath, { recursive: true });
		}
	}

	@bindThis
	private async ensureAllDirectories(): Promise<void> {
		try {
			await fs.access(this.dataPath);
		} catch {
			await fs.mkdir(this.dataPath, { recursive: true });
		}

		try {
			await fs.access(this.syncDataPath);
		} catch {
			await fs.mkdir(this.syncDataPath, { recursive: true });
		}
	}

	@bindThis
	private getGridKey(lat: number, lon: number): string {
		const gridLat = Math.floor(lat / this.GRID_SIZE) * this.GRID_SIZE;
		const gridLon = Math.floor(lon / this.GRID_SIZE) * this.GRID_SIZE;
		return `${gridLat.toFixed(1)}_${gridLon.toFixed(1)}`;
	}

	@bindThis
	private addToSpatialIndex(entry: GeoDataEntry): void {
		const key = this.getGridKey(entry.lat, entry.lon);
		if (!this.spatialIndex.has(key)) {
			this.spatialIndex.set(key, []);
		}
		this.spatialIndex.get(key)!.push(entry);
	}

	@bindThis
	private addToHierarchicalIndex(entry: GeoDataEntry): void {
		const keys = this.GRID_LEVELS.map(level =>
			this.getHierarchicalGridKey(entry.lat, entry.lon, level.size)
		);

		this.ensureHierarchicalPath(keys);
		this.getDeepestIndexLevel(keys).push(entry);

		const l4Key = keys[3];
		this.gridStats.set(l4Key, (this.gridStats.get(l4Key) || 0) + 1);
	}

	@bindThis
	private getHierarchicalGridKey(lat: number, lon: number, gridSize: number): string {
		const gridLat = Math.floor(lat / gridSize) * gridSize;
		const gridLon = Math.floor(lon / gridSize) * gridSize;
		return `${gridLat.toFixed(6)}_${gridLon.toFixed(6)}`;
	}

	@bindThis
	private ensureHierarchicalPath(keys: string[]): void {
		let currentLevel = this.hierarchicalIndex;

		for (let i = 0; i < keys.length - 1; i++) {
			if (!currentLevel.has(keys[i])) {
				currentLevel.set(keys[i], new Map());
			}
			currentLevel = currentLevel.get(keys[i]) as any;
		}

		if (!currentLevel.has(keys[keys.length - 1])) {
			currentLevel.set(keys[keys.length - 1], [] as any);
		}
	}

	@bindThis
	private getDeepestIndexLevel(keys: string[]): GeoDataEntry[] {
		let currentLevel = this.hierarchicalIndex as any;
		for (const key of keys) {
			currentLevel = currentLevel.get(key);
		}
		return currentLevel;
	}

	@bindThis
	private optimizeDenseGrids(): void {
		const denseGrids = Array.from(this.gridStats.entries())
			.filter(([_, count]) => count > 1000)
			.sort(([_, a], [__, b]) => b - a);

		if (denseGrids.length > 0) {
			console.log(`Found ${denseGrids.length} dense grids, max density: ${denseGrids[0][1]} entries`);
		}
	}

	@bindThis
	private validateGeoDataEntry(entry: Partial<GeoDataEntry>): { isValid: boolean; issues: string[] } {
		const issues: string[] = [];

		if (typeof entry.lat !== 'number' || isNaN(entry.lat)) {
			issues.push('Invalid latitude');
		} else if (entry.lat < this.MIN_VALID_LAT || entry.lat > this.MAX_VALID_LAT) {
			issues.push(`Latitude out of range: ${entry.lat}`);
		}

		if (typeof entry.lon !== 'number' || isNaN(entry.lon)) {
			issues.push('Invalid longitude');
		} else if (entry.lon < this.MIN_VALID_LON || entry.lon > this.MAX_VALID_LON) {
			issues.push(`Longitude out of range: ${entry.lon}`);
		}

		if (entry.lat && entry.lon) {
			const latPrecision = this.getDecimalPrecision(entry.lat);
			const lonPrecision = this.getDecimalPrecision(entry.lon);
			if (latPrecision > 8 || lonPrecision > 8) {
				issues.push('Suspiciously precise coordinates');
			}
		}

		if (typeof entry.importance === 'number') {
			if (entry.importance < this.MIN_IMPORTANCE || entry.importance > this.MAX_IMPORTANCE) {
				issues.push(`Importance out of range: ${entry.importance}`);
			}
		}

		if (entry.properties?.name) {
			if (entry.properties.name.length > this.MAX_NAME_LENGTH) {
				issues.push('Name too long');
			}
			if (!/^[\p{L}\p{N}\p{P}\p{Z}]+$/u.test(entry.properties.name)) {
				issues.push('Name contains invalid characters');
			}
		}

		if (entry.place_id !== undefined && (!Number.isInteger(entry.place_id) || entry.place_id <= 0)) {
			issues.push('Invalid place_id');
		}

		if (entry.osm_id !== undefined && (!Number.isInteger(entry.osm_id) || entry.osm_id < 0)) {
			issues.push('Invalid osm_id');
		}

		return { isValid: issues.length === 0, issues };
	}

	@bindThis
	private getDecimalPrecision(num: number): number {
		const str = num.toString();
		if (str.indexOf('.') === -1) return 0;
		return str.split('.')[1].length;
	}

	@bindThis
	private filterAndValidateData(entries: Partial<GeoDataEntry>[]): GeoDataEntry[] {
		const validEntries: GeoDataEntry[] = [];
		const seenCoordinates = new Set<string>();

		for (const entry of entries) {
			this.dataQualityStats.totalProcessed++;

			const validation = this.validateGeoDataEntry(entry);

			if (!validation.isValid) {
				if (validation.issues.some(issue => issue.includes('coordinate'))) {
					this.dataQualityStats.invalidCoordinates++;
				}
				if (validation.issues.some(issue => issue.includes('name'))) {
					this.dataQualityStats.invalidNames++;
				}
				if (validation.issues.some(issue => issue.includes('Suspicious'))) {
					this.dataQualityStats.suspiciousData++;
				}
				continue;
			}

			const coordKey = `${entry.lat?.toFixed(6)}_${entry.lon?.toFixed(6)}_${entry.place_id}`;
			if (seenCoordinates.has(coordKey)) {
				this.dataQualityStats.duplicates++;
				continue;
			}
			seenCoordinates.add(coordKey);

			validEntries.push(entry as GeoDataEntry);
			this.dataQualityStats.validEntries++;
		}

		return validEntries;
	}

	@bindThis
	private async robustNetworkRequest<T>(url: string, options: {
		method?: 'GET' | 'POST';
		headers?: Record<string, string>;
		body?: string;
		timeout?: number;
		maxRetries?: number;
		retryDelayBase?: number;
	} = {}): Promise<T> {
		const {
			method = 'GET',
			headers = {},
			body,
			timeout = this.NETWORK_TIMEOUT,
			maxRetries = this.MAX_RETRIES,
			retryDelayBase = this.RETRY_DELAY_BASE
		} = options;

		const requestId = `${method}_${url}`;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const startTime = Date.now();

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				try {
					const response = await this.httpRequestService.send(url, {
						method,
						headers: {
							'Accept': 'application/json, text/plain, */*',
							'Accept-Encoding': 'gzip, deflate',
							'Connection': 'keep-alive',
							...headers
						},
						body,
						signal: controller.signal
					} as any);

					clearTimeout(timeoutId);

					const duration = Date.now() - startTime;
					this.logger.info(`Network request successful: ${ requestId } (${ duration }ms, attempt ${ attempt + 1 })`);

					this.networkRetryStats.delete(requestId);
					return response as T;
				} catch (fetchError) {
					clearTimeout(timeoutId);
					throw fetchError;
				}
			} catch (error: any) {
				lastError = error;
				const retryCount = this.networkRetryStats.get(requestId) || 0;
				this.networkRetryStats.set(requestId, retryCount + 1);

				const isRetryableError = this.isRetryableError(error);
				const shouldRetry = attempt < maxRetries && isRetryableError;

				this.logger.warn(`Network request failed: ${requestId} (attempt ${attempt + 1}/${maxRetries + 1})`, {
					error: error.message,
					isRetryable: isRetryableError,
					willRetry: shouldRetry
				});

				if (!shouldRetry) {
					break;
				}

				const delay = retryDelayBase * Math.pow(2, attempt) + Math.random() * 1000;
				this.logger.info(`Retrying in ${Math.round(delay)}ms...`);
				await this.sleep(delay);
			}
		}

		throw new Error(`Network request failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
	}

	@bindThis
	private isRetryableError(error: any): boolean {
		if (error.name === 'AbortError' || error.code === 'TIMEOUT') return true;
		if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') return true;
		if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;

		if (error.status >= 500) return true;
		if (error.status === 429) return true;
		if (error.status === 408) return true;

		return !(error.status >= 400 && error.status < 500);
	}

	@bindThis
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	@bindThis
	private async streamDecompressFile(zipPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const readStream = createReadStream(zipPath);
			const writeStream = createWriteStream(outputPath);
			const unzipStream = zlib.createUnzip();

			readStream
				.pipe(unzipStream)
				.pipe(writeStream)
				.on('finish', () => {
					this.logger.info('Stream decompression completed');
					resolve();
				})
				.on('error', (error: any) => {
					this.logger.error('Stream decompression failed:', error);
					reject(error);
				});

			readStream.on('error', (error: any) => {
				this.logger.error('Read stream error:', error);
				reject(error);
			});
		});
	}

	@bindThis
	private async loadGeoDataFromFile(filename: string): Promise<GeoDataEntry[]> {
		const filePath = path.join(this.dataPath, filename);
		try {
			const data = await fs.readFile(filePath, 'utf-8');
			return JSON.parse(data) as GeoDataEntry[];
		} catch (error) {
			console.warn(`Failed to load geodata from ${filename}:`, error);
			return [];
		}
	}

	@bindThis
	private async saveGeoDataToFile(filename: string, data: GeoDataEntry[]): Promise<void> {
		await this.ensureDataDirectory();
		const filePath = path.join(this.dataPath, filename);
		try {
			await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
			console.log(`Saved ${data.length} entries to ${filename}`);
		} catch (error) {
			console.error(`Failed to save geodata to ${filename}:`, error);
		}
	}

	@bindThis
	private async initialize(): Promise<void> {
		if (this.isInitialized) return;

		console.log('Initializing offline geocoding service...');

		const dataFiles = [
			'cities_world.json',
			'cities_china.json',
			'administrative_divisions.json',
			'poi_data.json'
		];

		for (const filename of dataFiles) {
			const entries = await this.loadGeoDataFromFile(filename);
			this.geoData.push(...entries);
		}

		if (this.geoData.length === 0) {
			await this.generateSampleData();
		}

		this.buildSpatialIndex();

		this.isInitialized = true;
		console.log(`Offline geocoding initialized with ${this.geoData.length} entries`);
	}

	@bindThis
	private buildSpatialIndex(): void {
		console.time('BuildIndex');
		this.spatialIndex.clear();
		this.hierarchicalIndex.clear();
		this.gridStats.clear();

		for (const entry of this.geoData) {
			this.addToSpatialIndex(entry);

			this.addToHierarchicalIndex(entry);
		}

		this.optimizeDenseGrids();
		console.timeEnd('BuildIndex');
		console.log(`Built optimized spatial index with ${this.spatialIndex.size} grid cells`);
	}

	@bindThis
	private async generateSampleData(): Promise<void> {
		const sampleData: GeoDataEntry[] = [];

		await this.saveGeoDataToFile('sample_data.json', sampleData);
		this.geoData = sampleData;
	}

	@bindThis
	private async findCandidatesWithElasticsearch(lat: number, lon: number, radiusKm: number = 50): Promise<GeoDataEntry[]> {
		if (!this.elasticClient) {
			return this.findCandidatesOptimized(lat, lon, radiusKm);
		}

		try {
			const response = await this.elasticClient.search({
				index: this.ES_INDEX_PREFIX,
				query: {
					bool: {
						filter: {
							geo_distance: {
								distance: `${radiusKm}km`,
								location: {
									lat,
									lon,
								},
							},
						},
					},
				},
				sort: [
					{
						_geo_distance: {
							location: { lat, lon },
							order: 'asc',
							unit: 'km',
						},
					},
					{ importance: { order: 'desc' } },
				],
				size: 100,
			} as any);

			const hits = (response as any).hits?.hits || [];
			return hits.map((hit: any) => ({
				...hit._source as GeoDataEntry,
				distance: hit.sort?.[0] || 0,
			}));
		} catch (error) {
			this.logger.warn('Elasticsearch query failed, fallback to optimized memory search:', error as any);
			return this.findCandidatesOptimized(lat, lon, radiusKm);
		}
	}

	@bindThis
	private findCandidatesOptimized(lat: number, lon: number, radiusKm: number = 50): GeoDataEntry[] {
		const startTime = performance.now();

		const cachedResult = this.getCachedCandidates(lat, lon, radiusKm);
		if (cachedResult) {
			console.log(`Cache hit: ${performance.now() - startTime}ms`);
			return cachedResult;
		}

		const level = this.selectOptimalLevel(radiusKm);
		const candidates = this.fastHierarchicalSearch(lat, lon, radiusKm, level);

		this.setCachedCandidates(lat, lon, radiusKm, candidates);

		console.log(`Optimized search took: ${performance.now() - startTime}ms, found ${candidates.length} candidates`);
		return candidates;
	}

	@bindThis
	private selectOptimalLevel(radiusKm: number): number {
		if (radiusKm >= 50) return 0;
		if (radiusKm >= 5) return 1;
		if (radiusKm >= 0.5) return 2;
		return 3;
	}

	@bindThis
	private fastHierarchicalSearch(lat: number, lon: number, radiusKm: number, level: number): GeoDataEntry[] {
		const candidates: GeoDataEntry[] = [];
		const gridSize = this.GRID_LEVELS[level].size;
		const gridRadius = Math.ceil(radiusKm / (gridSize * 111));

		for (let latOffset = -gridRadius; latOffset <= gridRadius; latOffset++) {
			for (let lonOffset = -gridRadius; lonOffset <= gridRadius; lonOffset++) {
				const searchLat = lat + (latOffset * gridSize);
				const searchLon = lon + (lonOffset * gridSize);

				const entries = this.getEntriesFromHierarchicalGrid(searchLat, searchLon, level);
				if (entries.length > 0) {
					this.batchDistanceFilter(lat, lon, radiusKm, entries, candidates);
				}
			}
		}

		return this.sortByImportanceAndDistance(candidates);
	}

	@bindThis
	private getEntriesFromHierarchicalGrid(lat: number, lon: number, level: number): GeoDataEntry[] {
		const keys = [];

		for (let i = 0; i <= level; i++) {
			keys.push(this.getHierarchicalGridKey(lat, lon, this.GRID_LEVELS[i].size));
		}

		try {
			let currentLevel = this.hierarchicalIndex as any;
			for (const key of keys) {
				currentLevel = currentLevel.get(key);
				if (!currentLevel) return [];
			}
			return currentLevel || [];
		} catch (error) {
			return [];
		}
	}

	@bindThis
	private batchDistanceFilter(centerLat: number, centerLon: number, radiusKm: number,
	                          entries: GeoDataEntry[], results: GeoDataEntry[]): void {
		const radiusSquared = radiusKm * radiusKm;
		const latRadians = centerLat * Math.PI / 180;

		for (const entry of entries) {
			const dLat = (entry.lat - centerLat) * 111;
			const dLon = (entry.lon - centerLon) * Math.cos(latRadians) * 111;
			const distanceSquared = dLat * dLat + dLon * dLon;

			if (distanceSquared <= radiusSquared) {
				(entry as any).distance = Math.sqrt(distanceSquared);
				results.push(entry);
			}
		}
	}

	@bindThis
	private sortByImportanceAndDistance(candidates: GeoDataEntry[]): GeoDataEntry[] {
		return candidates.sort((a, b) => {
			const aDistance = (a as any).distance || 0;
			const bDistance = (b as any).distance || 0;
			const aImportance = this.getImportanceScore(a);
			const bImportance = this.getImportanceScore(b);

			return (bImportance - aImportance) || (aDistance - bDistance);
		});
	}

	@bindThis
	private getCachedCandidates(lat: number, lon: number, radiusKm: number, precision = 3): GeoDataEntry[] | null {
		const key = `${lat.toFixed(precision)}_${lon.toFixed(precision)}_${radiusKm}`;
		const cached = this.cache.get(key);

		if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
			return (cached.result.features[0]?.properties as any)?.candidates || null;
		}
		return null;
	}

	@bindThis
	private setCachedCandidates(lat: number, lon: number, radiusKm: number, candidates: GeoDataEntry[], precision = 3): void {
		const key = `${lat.toFixed(precision)}_${lon.toFixed(precision)}_${radiusKm}`;

		if (this.cache.size >= this.MAX_CACHE_SIZE) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) this.cache.delete(firstKey);
		}

		const mockResult: GeocodingResult = {
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: { candidates } as any
			}]
		};

		this.cache.set(key, { result: mockResult, timestamp: Date.now() });
	}

	@bindThis
	private getCachedGeocodingResult(lat: number, lon: number, precision = 3): GeocodingResult | null {
		const key = `geo_${lat.toFixed(precision)}_${lon.toFixed(precision)}`;
		const cached = this.cache.get(key);

		if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
			return cached.result;
		}
		return null;
	}

	@bindThis
	private setCachedGeocodingResult(lat: number, lon: number, result: GeocodingResult, precision = 3): void {
		const key = `geo_${lat.toFixed(precision)}_${lon.toFixed(precision)}`;

		if (this.cache.size >= this.MAX_CACHE_SIZE) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) this.cache.delete(firstKey);
		}

		this.cache.set(key, { result, timestamp: Date.now() });
	}

	@bindThis
	private getPrecomputedResult(lat: number, lon: number, precision = 3): GeocodingResult | null {
		const key = `${lat.toFixed(precision)}_${lon.toFixed(precision)}`;
		return this.precomputedResults.get(key) || null;
	}

	@bindThis
	public async precomputeHotSpots(hotSpots: Array<{ lat: number, lon: number, frequency: number }>): Promise<void> {
		console.log('Precomputing hot spot regions...');
		const PRECOMPUTE_GRID_SIZE = 0.001;

		for (const hotSpot of hotSpots) {
			const radius = 0.01;
			const step = PRECOMPUTE_GRID_SIZE;

			for (let lat = hotSpot.lat - radius; lat <= hotSpot.lat + radius; lat += step) {
				for (let lon = hotSpot.lon - radius; lon <= hotSpot.lon + radius; lon += step) {
					const key = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
					if (!this.precomputedResults.has(key)) {
						const candidates = await this.findCandidatesWithElasticsearch(lat, lon, 50);
						if (candidates.length > 0) {
							const result = this.createGeoJsonFromEntry(lat, lon, candidates[0]);
							this.precomputedResults.set(key, result);
						}
					}
				}
			}
		}

		console.log(`Precomputation completed: ${this.precomputedResults.size} results`);
	}

	@bindThis
	public getOptimizedStats(): {
		totalEntries: number;
		gridCells: number;
		cacheSize: number;
		precomputedResults: number;
		memoryUsage: string;
		performanceProfile: any;
		dataQuality: any;
		networkStats: any;
	} {
		const memoryUsage = process.memoryUsage();
		return {
			totalEntries: this.geoData.length,
			gridCells: this.spatialIndex.size,
			cacheSize: this.cache.size,
			precomputedResults: this.precomputedResults.size,
			memoryUsage: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
			performanceProfile: {
				hierarchicalLevels: this.GRID_LEVELS.length,
				cacheTTL: this.CACHE_TTL,
				maxCacheSize: this.MAX_CACHE_SIZE,
				denseGrids: Array.from(this.gridStats.entries())
					.filter(([_, count]) => count > 100)
					.length,
				maxMemoryUsage: `${Math.round(this.MAX_MEMORY_USAGE / 1024 / 1024)}MB`,
				streamChunkSize: `${Math.round(this.STREAM_CHUNK_SIZE / 1024)}KB`
			},
			dataQuality: {
				...this.dataQualityStats,
				validityRate: this.dataQualityStats.totalProcessed > 0
					? Math.round((this.dataQualityStats.validEntries / this.dataQualityStats.totalProcessed) * 100)
					: 0
			},
			networkStats: {
				totalRetries: Array.from(this.networkRetryStats.values()).reduce((sum, count) => sum + count, 0),
				failedEndpoints: this.networkRetryStats.size,
				maxRetries: this.MAX_RETRIES,
				networkTimeout: this.NETWORK_TIMEOUT
			}
		};
	}

	@bindThis
	public resetDataQualityStats(): void {
		this.dataQualityStats = {
			totalProcessed: 0,
			validEntries: 0,
			invalidCoordinates: 0,
			invalidNames: 0,
			duplicates: 0,
			suspiciousData: 0
		};
		this.networkRetryStats.clear();
		this.logger.info('Data quality and network statistics reset');
	}

	@bindThis
	public async performHealthCheck(): Promise<{
		healthy: boolean;
		issues: string[];
		recommendations: string[];
	}> {
		const issues: string[] = [];
		const recommendations: string[] = [];

		const memUsage = process.memoryUsage();
		if (memUsage.heapUsed > this.MAX_MEMORY_USAGE * 0.8) {
			issues.push(`High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
			recommendations.push('Consider clearing cache or reducing data set size');
		}

		const validityRate = this.dataQualityStats.totalProcessed > 0
			? (this.dataQualityStats.validEntries / this.dataQualityStats.totalProcessed) * 100
			: 100;

		if (validityRate < 80) {
			issues.push(`Low data validity rate: ${Math.round(validityRate)}%`);
			recommendations.push('Review data sources and validation rules');
		}

		const totalRetries = Array.from(this.networkRetryStats.values()).reduce((sum, count) => sum + count, 0);
		if (totalRetries > 10) {
			issues.push(`High network retry count: ${totalRetries}`);
			recommendations.push('Check network connectivity and endpoint reliability');
		}

		if (this.geoData.length > 0 && this.spatialIndex.size === 0) {
			issues.push('Spatial index not built');
			recommendations.push('Rebuild spatial index for better performance');
		}

		return {
			healthy: issues.length === 0,
			issues,
			recommendations
		};
	}

	@bindThis
	public clearOptimizationCache(): void {
		this.cache.clear();
		this.precomputedResults.clear();
		console.log('Optimization cache cleared');
	}

	@bindThis
	public async initializeForHighPerformance(): Promise<void> {
		console.log('Initializing high-performance geocoding...');

		await this.initialize();
		if (this.geoData.length > 0) {
			this.buildSpatialIndex();
		}

		const commonHotSpots = [
			{ lat: 39.9042, lon: 116.4074, frequency: 1000 },
			{ lat: 31.2304, lon: 121.4737, frequency: 1000 },
			{ lat: 22.3193, lon: 114.1694, frequency: 800 },
			{ lat: 35.6762, lon: 139.6503, frequency: 900 },
			{ lat: 40.7128, lon: -74.0060, frequency: 700 },
		];

		await this.precomputeHotSpots(commonHotSpots);

		console.log('High-performance initialization complete!');
		console.log('Performance stats:', this.getOptimizedStats());
	}

	@bindThis
	public async batchReverseGeocode(coordinates: Array<{ lat: number, lon: number, id?: string }>): Promise<Array<{ id?: string, result: GeocodingResult }>> {
		await this.initialize();

		const results: Array<{ id?: string, result: GeocodingResult }> = [];
		const batches = [];

		for (let i = 0; i < coordinates.length; i += this.CONCURRENT_SEARCH_LIMIT) {
			batches.push(coordinates.slice(i, i + this.CONCURRENT_SEARCH_LIMIT));
		}

		for (const batch of batches) {
			const batchPromises = batch.map(async (coord) => {
				const result = await this.reverseGeocode(coord.lat, coord.lon);
				return { id: coord.id, result };
			});

			const batchResults = await Promise.all(batchPromises);
			results.push(...batchResults);
		}

		return results;
	}

	@bindThis
	public async searchByName(name: string, limit: number = 10): Promise<GeocodingResult[]> {
		await this.initialize();

		if (this.elasticClient) {
			return this.searchByNameWithElasticsearch(name, limit);
		}

		return this.searchByNameInMemory(name, limit);
	}

	@bindThis
	private async searchByNameWithElasticsearch(name: string, limit: number): Promise<GeocodingResult[]> {
		try {
			const response = await this.elasticClient!.search({
				index: this.ES_INDEX_PREFIX,
				query: {
					multi_match: {
						query: name,
						fields: [
							'properties.name^3',
							'properties.display_name^2',
							'properties.city^2',
							'properties.town^2',
							'properties.village',
							'properties.county',
							'properties.state',
							'properties.country',
						],
						type: 'best_fields',
						fuzziness: 'AUTO',
					},
				},
				sort: [
					{ _score: { order: 'desc' } },
					{ importance: { order: 'desc' } },
				],
				size: limit,
			} as any);

			const hits = (response as any).hits?.hits || [];
			return hits.map((hit: any) =>
				this.convertToGeocodingResult(hit._source as GeoDataEntry)
			);
		} catch (error) {
			this.logger.warn('Elasticsearch name search failed, fallback to memory search:', error as any);
			return this.searchByNameInMemory(name, limit);
		}
	}

	@bindThis
	private searchByNameInMemory(name: string, limit: number): GeocodingResult[] {
		const searchTerm = name.toLowerCase();
		const matches: Array<{ entry: GeoDataEntry, score: number }> = [];

		for (const entry of this.geoData) {
			let score = 0;

			if (entry.properties.name?.toLowerCase() === searchTerm) score += 100;
			else if (entry.properties.name?.toLowerCase().includes(searchTerm)) score += 50;

			if (entry.properties.city?.toLowerCase().includes(searchTerm)) score += 30;
			if (entry.properties.town?.toLowerCase().includes(searchTerm)) score += 25;
			if (entry.properties.village?.toLowerCase().includes(searchTerm)) score += 20;
			if (entry.properties.county?.toLowerCase().includes(searchTerm)) score += 15;
			if (entry.properties.state?.toLowerCase().includes(searchTerm)) score += 10;
			if (entry.properties.country?.toLowerCase().includes(searchTerm)) score += 5;

			if (score > 0) {
				score += entry.importance * 10;
				matches.push({ entry, score });
			}
		}

		return matches
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map(match => this.convertToGeocodingResult(match.entry));
	}

	@bindThis
	private convertToGeocodingResult(entry: GeoDataEntry): GeocodingResult {
		return {
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				properties: {
					...entry.properties,
					name: entry.properties.name || entry.properties.city || entry.properties.town,
					display_name: entry.properties.display_name || this.formatDisplayName(entry.properties),
				},
				geometry: {
					type: 'Point',
					coordinates: [entry.lon, entry.lat]
				}
			}]
		};
	}

	@bindThis
	private getImportanceScore(entry: GeoDataEntry): number {
		let score = entry.importance * 100 || 0;

		switch (entry.level) {
			case 'country': score += 1000; break;
			case 'state': score += 500; break;
			case 'city': score += 100; break;
			case 'town': score += 50; break;
			case 'district': score += 25; break;
			case 'village': score += 10; break;
		}

		if (entry.population) {
			score += Math.log10(entry.population) * 10;
		}

		return score;
	}

	@bindThis
	private createGeoJsonFromEntry(lat: number, lon: number, entry: GeoDataEntry): GeocodingResult {
		return {
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				properties: {
					...entry.properties,
					name: entry.properties.name || entry.properties.city || entry.properties.town,
					display_name: this.formatDisplayName(entry.properties),
				},
				geometry: {
					type: 'Point',
					coordinates: [lon, lat]
				}
			}]
		};
	}

	@bindThis
	private formatDisplayName(properties: any): string {
		const parts: string[] = [];

		if (properties.name) parts.push(properties.name);
		if (properties.city && properties.city !== properties.name) parts.push(properties.city);
		if (properties.county && properties.county !== properties.city) parts.push(properties.county);
		if (properties.state) parts.push(properties.state);
		if (properties.country) parts.push(properties.country);

		return parts.join(', ');
	}

	@bindThis
	private createEmptyGeoJson(lat: number, lon: number): GeocodingResult {
		return {
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Point',
					coordinates: [lon, lat]
				}
			}]
		};
	}

	@bindThis
	public async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult> {
		const startTime = performance.now();

		await this.initialize();

		if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
			return this.createEmptyGeoJson(lat, lon);
		}

		const cachedResult = this.getCachedGeocodingResult(lat, lon);
		if (cachedResult) {
			console.log(`Geocoding cache hit: ${performance.now() - startTime}ms`);
			return cachedResult;
		}

		const precomputed = this.getPrecomputedResult(lat, lon);
		if (precomputed) {
			console.log(`Precomputed hit: ${performance.now() - startTime}ms`);
			this.setCachedGeocodingResult(lat, lon, precomputed);
			return precomputed;
		}

		let candidates = await this.findCandidatesWithElasticsearch(lat, lon, 50);

		if (candidates.length === 0) {
			candidates = await this.findCandidatesWithElasticsearch(lat, lon, 200);
			if (candidates.length === 0) {
				return this.createEmptyGeoJson(lat, lon);
			}
		}

		const result = this.createGeoJsonFromEntry(lat, lon, candidates[0]);

		this.setCachedGeocodingResult(lat, lon, result);

		const totalTime = performance.now() - startTime;
		console.log(`Total geocoding time: ${totalTime}ms`);

		return result;
	}

	@bindThis
	public async importGeoData(data: GeoDataEntry[], filename?: string): Promise<void> {
		if (filename) {
			await this.saveGeoDataToFile(filename, data);
		}

		this.geoData.push(...data);
		this.buildSpatialIndex();

		this.logger.info(`Imported ${data.length} geo entries`);
	}

	@bindThis
	public async getStats(): Promise<{ totalEntries: number; gridCells: number; memoryUsage: string }> {
		const memoryUsage = process.memoryUsage();
		return {
			totalEntries: this.geoData.length,
			gridCells: this.spatialIndex.size,
			memoryUsage: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
		};
	}

	@bindThis
	public async onApplicationShutdown(): Promise<void> {
		for (const worker of this.workerPool) {
			await worker.terminate();
		}
		this.workerPool = [];
	}

	@bindThis
	private generateDataHash(data: any): string {
		return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
	}

	@bindThis
	private async downloadOfflineGeoData(): Promise<GeoDataEntry[]> {
		this.logger.info('Starting download of detailed offline geodata...');

		const results: GeoDataEntry[] = [];

		if (this.config.offlineGeocoding?.downloadFullGeoNames !== false) {
			const fullGeoNamesData = await this.downloadAndProcessFullGeoNames();
			results.push(...fullGeoNamesData);
			this.logger.info(`Full GeoNames data: ${fullGeoNamesData.length} entries`);
		} else {
			const cityData = await this.downloadAndProcessGeoNamesCities();
			results.push(...cityData);
			this.logger.info(`City data: ${cityData.length} entries`);
		}

		if (this.config.offlineGeocoding?.downloadOSM) {
			const osmData = await this.downloadAndProcessOSMPBF();
			results.push(...osmData);
			this.logger.info(`OSM data: ${osmData.length} entries`);
		}

		this.logger.info(`Offline data download completed, obtained ${results.length} entries`);

		if (results.length > this.COMPRESS_THRESHOLD && !this.elasticClient) {
			await this.convertToBinaryFormat(results);
		}

		return results;
	}

	@bindThis
	private async downloadAndProcessFullGeoNames(): Promise<GeoDataEntry[]> {
		this.logger.info('Downloading full GeoNames data (this will take a long time)...');

		const results: GeoDataEntry[] = [];

		try {
			const allCountriesPath = path.join(this.syncDataPath, 'allCountries.zip');
			this.logger.info('Downloading allCountries.zip (~300MB)...');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.allCountries, allCountriesPath);

			const alternateNamesPath = path.join(this.syncDataPath, 'alternateNames.zip');
			this.logger.info('Downloading alternateNames.zip (multilingual names)...');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.alternateNames, alternateNamesPath);

			const admin1Path = path.join(this.syncDataPath, 'admin1Codes.txt');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.admin1Codes, admin1Path);

			const mainData = await this.processLargeGeoNamesFile(allCountriesPath);
			results.push(...mainData);
			this.logger.info(`Main data processed: ${ mainData.length } records`);

			if ((this.config as any).offlineGeocoding?.includeAlternateNames !== false) {
				await this.processAlternateNames(alternateNamesPath, results);
			}
		} catch (error) {
			this.logger.error('Processing full GeoNames data failed:', error as any);
			return this.downloadAndProcessGeoNamesCities();
		}

		return results;
	}

	@bindThis
	private async downloadAndProcessGeoNamesCities(): Promise<GeoDataEntry[]> {
		const results: GeoDataEntry[] = [];

		const datasets = [
			{ name: 'cities15000', url: this.OSM_DATA_SOURCES.cities15000, minPopulation: 15000 },
			{ name: 'cities5000', url: this.OSM_DATA_SOURCES.cities5000, minPopulation: 5000 },
			{ name: 'cities1000', url: this.OSM_DATA_SOURCES.cities1000, minPopulation: 1000 },
			{ name: 'cities500', url: this.OSM_DATA_SOURCES.cities500, minPopulation: 500 },
		];

		for (const dataset of datasets) {
			try {
				this.logger.info(`Downloading ${dataset.name} data...`);

				const zipPath = path.join(this.syncDataPath, `${dataset.name}.zip`);
				await this.downloadService.downloadUrl(dataset.url, zipPath);

				const geoData = await this.processGeoNamesZip(zipPath, dataset.minPopulation);
				results.push(...geoData);

				this.logger.info(`${dataset.name} processed: ${geoData.length} records`);
			} catch (error) {
				this.logger.error(`Processing ${dataset.name} failed:`, error as any);
			}
		}

		return results;
	}

	@bindThis
	private async processGeoNamesZip(zipPath: string, minPopulation: number): Promise<GeoDataEntry[]> {
		const results: GeoDataEntry[] = [];

		try {
			const zipData = await fs.readFile(zipPath);
			const unzippedData = zlib.unzipSync(zipData);

			const csvContent = unzippedData.toString('utf-8');
			const lines = csvContent.split('\n');

			for (const line of lines) {
				if (!line.trim()) continue;

				const parts = line.split('\t');
				if (parts.length < 19) continue;

				try {
					const geoEntry = this.parseGeoNamesLine(parts, minPopulation);
					if (geoEntry) {
						results.push(geoEntry);
					}
				} catch (parseError) {
				}
			}
		} catch (error) {
			this.logger.error('Failed to parse GeoNames ZIP file:', error as any);
		}

		return results;
	}

	@bindThis
	private parseGeoNamesLine(parts: string[], minPopulation: number): GeoDataEntry | null {
		const population = parseInt(parts[14]) || 0;
		if (population < minPopulation) return null;

		const lat = parseFloat(parts[4]);
		const lon = parseFloat(parts[5]);
		if (isNaN(lat) || isNaN(lon)) return null;

		const featureClass = parts[6];
		const featureCode = parts[7];
		const level = this.determineGeoNamesLevel(featureClass, featureCode, population);

		let importance = 0;
		if (population > 0) {
			importance = Math.log10(population) / 10;
		}

		return {
			lat,
			lon,
			properties: {
				name: parts[2],
				display_name: parts[1],
				country_code: parts[8],
				admin1: parts[10],
				admin2: parts[11],
				feature_class: featureClass,
				feature_code: featureCode,
				timezone: parts[17],
			},
			level,
			population,
			importance,
			place_id: parseInt(parts[0]),
			osm_id: 0,
			hash: this.generateDataHash(parts[0]),
		};
	}

	@bindThis
	private determineGeoNamesLevel(featureClass: string, featureCode: string, population: number): GeoDataEntry['level'] {
		if (featureClass === 'A') {
			if (featureCode === 'PCLI') return 'country';
			if (featureCode.startsWith('ADM1')) return 'state';
			if (featureCode.startsWith('ADM2')) return 'county';
			return 'district';
		}

		if (featureClass === 'P') {
			if (featureCode === 'PPLC') return 'city';
			if (featureCode === 'PPLA') return 'city';
			if (featureCode === 'PPL') {
				if (population > 100000) return 'city';
				if (population > 10000) return 'town';
				return 'village';
			}
			return 'town';
		}

		return 'district';
	}

	@bindThis
	private async processLargeGeoNamesFile(zipPath: string): Promise<GeoDataEntry[]> {
		this.logger.info('Starting robust streaming processing of large GeoNames file...');

		const results: GeoDataEntry[] = [];
		const CHUNK_SIZE = 50000;
		const MEMORY_CHECK_INTERVAL = 10000;

		try {
			const tempCsvPath = path.join(this.syncDataPath, 'allCountries.txt');

			await this.streamDecompressFile(zipPath, tempCsvPath);

			const fileStats = await stat(tempCsvPath);
			const totalSize = fileStats.size;

			this.logger.info(`Starting to process ${Math.round(totalSize / 1024 / 1024)}MB file`);

			return new Promise((resolve, reject) => {
				let processedSize = 0;
				let lineCount = 0;
				let validEntryCount = 0;
				let memoryWarningCount = 0;
				const stream = createReadStream(tempCsvPath, {
					encoding: 'utf-8',
					highWaterMark: this.STREAM_CHUNK_SIZE
				});

				let buffer = '';
				let chunkData: Partial<GeoDataEntry>[] = [];

				stream.on('data', (chunk: string | Buffer) => {
					stream.pause();

					const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
					buffer += chunkStr;
					processedSize += Buffer.byteLength(chunkStr);

					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						lineCount++;

						if (!line.trim()) continue;

						try {
							const parts = line.split('\t');
							if (parts.length >= 19) {
								const entry = this.parseGeoNamesLine(parts, 0);
								if (entry) {
									chunkData.push(entry);
									validEntryCount++;
								}
							}
						} catch (parseError) {
							if (lineCount % 100000 === 0) {
								this.logger.warn(`Parse error at line ${lineCount}: ${parseError}`);
							}
						}

						if (lineCount % MEMORY_CHECK_INTERVAL === 0) {
							const memUsage = process.memoryUsage();
							if (memUsage.heapUsed > this.MAX_MEMORY_USAGE) {
								memoryWarningCount++;
								this.logger.warn(`High memory usage detected: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);

								if (global.gc) {
									global.gc();
								}
							}
						}
					}

					if (chunkData.length >= CHUNK_SIZE) {
						const validEntries = this.filterAndValidateData(chunkData);
						results.push(...validEntries);
						chunkData = [];

						const progress = Math.round((processedSize / totalSize) * 100);
						this.logger.info(`Processing progress: ${progress}% (${lineCount} lines, ${validEntryCount} valid entries)`);

						setTimeout(() => {
							stream.resume();
						}, 50);
						return;
					}

					setImmediate(() => stream.resume());
				});

				stream.on('end', () => {
					try {
						if (buffer.trim()) {
							try {
								const parts = buffer.split('\t');
								if (parts.length >= 19) {
									const entry = this.parseGeoNamesLine(parts, 0);
									if (entry) {
										chunkData.push(entry);
										validEntryCount++;
									}
								}
							} catch (parseError) {
								this.logger.warn('Failed to parse final buffer data:', parseError as Error);
							}
						}

						if (chunkData.length > 0) {
							const validEntries = this.filterAndValidateData(chunkData);
							results.push(...validEntries);
						}

						this.logger.info(`File processing completed:`);
						this.logger.info(`- Total lines processed: ${lineCount}`);
						this.logger.info(`- Valid entries: ${this.dataQualityStats.validEntries}`);
						this.logger.info(`- Invalid coordinates: ${this.dataQualityStats.invalidCoordinates}`);
						this.logger.info(`- Duplicates removed: ${this.dataQualityStats.duplicates}`);
						this.logger.info(`- Suspicious data filtered: ${this.dataQualityStats.suspiciousData}`);
						this.logger.info(`- Memory warnings: ${memoryWarningCount}`);
						this.logger.info(`- Final result count: ${results.length}`);

						resolve(results);
					} catch (endError) {
						this.logger.error('Error during stream end processing:', (endError as Error));
						reject(endError);
					}
				});

				stream.on('error', reject);
			});
		} catch (error) {
			this.logger.error('Failed to process large GeoNames file:', error as any);
			return [];
		}
	}

	@bindThis
	private async processAlternateNames(zipPath: string, mainData: GeoDataEntry[]): Promise<void> {
		this.logger.info('Processing multilingual names data...');

		try {
			const geonameIdIndex = new Map<number, GeoDataEntry>();
			for (const entry of mainData) {
				geonameIdIndex.set(entry.place_id, entry);
			}

			const zipData = await fs.readFile(zipPath);
			const decompressed = zlib.unzipSync(zipData);
			const content = decompressed.toString('utf-8');

			const lines = content.split('\n');
			let processedCount = 0;

			for (const line of lines) {
				if (!line.trim()) continue;

				const parts = line.split('\t');
				if (parts.length >= 4) {
					const geonameId = parseInt(parts[1]);
					const alternateName = parts[3];
					const isoLanguage = parts[2];

					const entry = geonameIdIndex.get(geonameId);
					if (entry && alternateName && isoLanguage) {
						if (!entry.properties.alternate_names) {
							entry.properties.alternate_names = {};
						}
						entry.properties.alternate_names[isoLanguage] = alternateName;
						processedCount++;
					}
				}

				if (processedCount % 100000 === 0) {
					this.logger.info(`Multilingual names processing progress: ${processedCount} entries`);
				}
			}

			this.logger.info(`Multilingual names processing completed: ${processedCount} entries`);
		} catch (error) {
			this.logger.warn('Failed to process multilingual names:', error as any);
		}
	}

	@bindThis
	private async downloadAndProcessOSMPBF(): Promise<GeoDataEntry[]> {
		this.logger.warn('Processing OSM PBF data requires a large amount of memory and time (several GB of data). Recommended to enable only when necessary.');

		return [];
	}

	@bindThis
	public async syncOfflineGeoData(): Promise<void> {
		if (this.syncInProgress) {
			this.logger.warn('Sync is already in progress, skipping this synchronization');
			return;
		}

		this.syncInProgress = true;
		try {
			this.logger.info('Starting offline geodata synchronization...');

			await this.ensureDirectory(this.syncDataPath);

			const newGeoData = await this.downloadOfflineGeoData();

			const optimizedData = await this.optimizeGeoData(newGeoData);

			const newVersion = this.currentDataVersion + 1;
			await this.saveDataWithVersion(optimizedData, newVersion);

			await this.buildSpatialIndexForData(optimizedData, newVersion);

			if (this.elasticClient) {
				await this.syncToElasticsearch(optimizedData, newVersion);
			}

			await this.switchToNewData(newVersion);

			await this.cleanupOldData(this.currentDataVersion);

			this.currentDataVersion = newVersion;
			this.logger.info(`Data synchronization completed, version: ${newVersion}, total entries: ${optimizedData.length}`);
		} catch (error) {
			this.logger.error('Data synchronization failed:', error as any);
			throw error;
		} finally {
			this.syncInProgress = false;
		}
	}

	@bindThis
	private async optimizeGeoData(data: GeoDataEntry[]): Promise<GeoDataEntry[]> {
		const uniqueEntries = new Map<string, GeoDataEntry>();

		for (const entry of data) {
			const key = `${entry.lat.toFixed(6)}_${entry.lon.toFixed(6)}_${entry.level}`;
			if (!uniqueEntries.has(key) ||
				entry.importance > (uniqueEntries.get(key)?.importance || 0)) {
				uniqueEntries.set(key, entry);
			}
		}

		return Array.from(uniqueEntries.values());
	}

	@bindThis
	private async saveDataWithVersion(data: GeoDataEntry[], version: number): Promise<void> {
		const filePath = path.join(this.syncDataPath, `geodata_v${version}.json`);
		await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
	}

	@bindThis
	private async buildSpatialIndexForData(data: GeoDataEntry[], version: number): Promise<void> {
		const spatialIndex = new Map<string, GeoDataEntry[]>();

		for (const entry of data) {
			const key = this.getGridKey(entry.lat, entry.lon);
			if (!spatialIndex.has(key)) {
				spatialIndex.set(key, []);
			}
			spatialIndex.get(key)!.push(entry);
		}

		const indexPath = path.join(this.syncDataPath, `spatial_index_v${version}.json`);
		await fs.writeFile(indexPath, JSON.stringify(Array.from(spatialIndex.entries())), 'utf-8');
	}

	@bindThis
	private async syncToElasticsearch(data: GeoDataEntry[], version: number): Promise<void> {
		if (!this.elasticClient) return;

		const indexName = `${this.ES_INDEX_PREFIX}_v${version}`;

		await this.elasticClient.indices.create({
			index: indexName,
			mappings: {
				properties: {
					location: { type: 'geo_point' },
					bounds: { type: 'geo_shape' },
					properties: { type: 'object' },
					level: { type: 'keyword' },
					importance: { type: 'float' },
					place_id: { type: 'long' },
					osm_id: { type: 'long' },
				},
			},
		} as any);

		for (let i = 0; i < data.length; i += this.BATCH_SIZE) {
			const batch = data.slice(i, i + this.BATCH_SIZE);
			const body = [];

			for (const entry of batch) {
				body.push({ index: { _index: indexName, _id: entry.place_id.toString() } });
				body.push({
					location: { lat: entry.lat, lon: entry.lon },
					bounds: entry.bounds ? {
						type: 'envelope',
						coordinates: [[entry.bounds[1], entry.bounds[2]], [entry.bounds[3], entry.bounds[0]]]
					} : undefined,
					...entry,
				});
			}

			await this.elasticClient.bulk({ body });
		}
	}

	@bindThis
	private async switchToNewData(newVersion: number): Promise<void> {
		const dataPath = path.join(this.syncDataPath, `geodata_v${newVersion}.json`);
		const indexPath = path.join(this.syncDataPath, `spatial_index_v${newVersion}.json`);

		const newData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
		const indexData = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

		this.geoData = newData;
		this.spatialIndex = new Map(indexData);

		if (this.elasticClient) {
			const aliasName = this.ES_INDEX_PREFIX;
			const newIndexName = `${this.ES_INDEX_PREFIX}_v${newVersion}`;
			const oldIndexName = `${this.ES_INDEX_PREFIX}_v${this.currentDataVersion}`;

			try {
				await this.elasticClient.indices.updateAliases({
					actions: [
						{ remove: { index: oldIndexName, alias: aliasName } },
						{ add: { index: newIndexName, alias: aliasName } },
					],
				} as any);
			} catch (error) {
				await this.elasticClient.indices.putAlias({
					index: newIndexName,
					name: aliasName,
				});
			}
		}
	}

	@bindThis
	private async cleanupOldData(oldVersion: number): Promise<void> {
		if (oldVersion === 0) return;

		try {
			await fs.unlink(path.join(this.syncDataPath, `geodata_v${oldVersion}.json`));
			await fs.unlink(path.join(this.syncDataPath, `spatial_index_v${oldVersion}.json`));
		} catch (error) {
			this.logger.warn('Failed to clean up old data files:', error as any);
		}

		if (this.elasticClient) {
			try {
				await this.elasticClient.indices.delete({
					index: `${this.ES_INDEX_PREFIX}_v${oldVersion}`,
				});
			} catch (error) {
				this.logger.warn('Failed to delete old ES index:', error as any);
			}
		}
	}

	@bindThis
	private async ensureDirectory(dirPath: string): Promise<void> {
		try {
			await fs.access(dirPath);
		} catch {
			await fs.mkdir(dirPath, { recursive: true });
		}
	}

	@bindThis
	public async optimizeData(): Promise<void> {
		this.geoData = await this.optimizeGeoData(this.geoData);
		this.buildSpatialIndex();

		this.logger.info(`Data optimization completed: ${this.geoData.length} entries`);
	}

	@bindThis
	private async convertToBinaryFormat(data: GeoDataEntry[]): Promise<void> {
		this.logger.info('Converting to efficient binary format...');

		try {
			const shards = this.shardData(data);

			for (let i = 0; i < shards.length; i++) {
				const shard = shards[i];
				const shardPath = path.join(this.dataPath, `geodata_shard_${i}.bin`);

				await this.writeBinaryShard(shard, shardPath);
				this.logger.info(`Shard ${i + 1}/${shards.length} saved: ${shard.length} entries`);
			}

			await this.createBinaryIndex(shards.length);

			this.logger.info(`Binary format conversion completed: ${shards.length} shards`);
		} catch (error) {
			this.logger.error('Binary format conversion failed:', error as any);
		}
	}

	@bindThis
	private shardData(data: GeoDataEntry[]): GeoDataEntry[][] {
		const shards: GeoDataEntry[][] = [];

		for (let i = 0; i < data.length; i += this.SHARD_SIZE) {
			shards.push(data.slice(i, i + this.SHARD_SIZE));
		}

		return shards;
	}

	@bindThis
	private async writeBinaryShard(shard: GeoDataEntry[], filePath: string): Promise<void> {
		const buffer = Buffer.alloc(this.calculateShardSize(shard));
		let offset = 0;

		buffer.writeUInt32LE(this.BINARY_FORMAT_VERSION, offset);
		offset += 4;
		buffer.writeUInt32LE(shard.length, offset);
		offset += 4;

		for (const entry of shard) {
			buffer.writeDoubleLE(entry.lat, offset);
			offset += 8;
			buffer.writeDoubleLE(entry.lon, offset);
			offset += 8;

			buffer.writeUInt32LE(entry.place_id, offset);
			offset += 4;
			buffer.writeUInt32LE(entry.osm_id, offset);
			offset += 4;

			buffer.writeFloatLE(entry.importance, offset);
			offset += 4;

			const levelCode = this.encodeLevelToByte(entry.level);
			buffer.writeUInt8(levelCode, offset);
			offset += 1;

			const nameBuffer = Buffer.from(entry.properties.name || '', 'utf-8');
			buffer.writeUInt16LE(nameBuffer.length, offset);
			offset += 2;
			nameBuffer.copy(buffer, offset);
			offset += nameBuffer.length;

			const propsJSON = JSON.stringify(entry.properties);
			const propsBuffer = Buffer.from(propsJSON, 'utf-8');
			buffer.writeUInt16LE(propsBuffer.length, offset);
			offset += 2;
			propsBuffer.copy(buffer, offset);
			offset += propsBuffer.length;
		}

		const compressed = zlib.gzipSync(buffer.subarray(0, offset));
		await fs.writeFile(filePath, compressed);
	}

	@bindThis
	private calculateShardSize(shard: GeoDataEntry[]): number {
		let size = 8;

		for (const entry of shard) {
			size += 33;
			size += (entry.properties.name?.length || 0) * 3;
			size += JSON.stringify(entry.properties).length * 3;
		}

		return Math.ceil(size * 1.2);
	}

	@bindThis
	private encodeLevelToByte(level: GeoDataEntry['level']): number {
		const levelMap = {
			'country': 1, 'state': 2, 'city': 3, 'town': 4,
			'village': 5, 'district': 6, 'county': 7
		};
		return levelMap[level] || 0;
	}

	@bindThis
	private decodeLevelFromByte(code: number): GeoDataEntry['level'] {
		const levelMap = {
			1: 'country', 2: 'state', 3: 'city', 4: 'town',
			5: 'village', 6: 'district', 7: 'county'
		} as const;
		return levelMap[code as keyof typeof levelMap] || 'district';
	}

	@bindThis
	private async createBinaryIndex(shardCount: number): Promise<void> {
		const indexData = {
			version: this.BINARY_FORMAT_VERSION,
			shardCount,
			compressed: true,
			createdAt: new Date().toISOString(),
		};

		const indexPath = path.join(this.dataPath, 'geodata.index');
		await fs.writeFile(indexPath, JSON.stringify(indexData), 'utf-8');
	}

	@bindThis
	public async loadFromBinaryFormat(): Promise<boolean> {
		try {
			const indexPath = path.join(this.dataPath, 'geodata.index');
			const indexContent = await fs.readFile(indexPath, 'utf-8');
			const indexData = JSON.parse(indexContent);

			if (indexData.version !== this.BINARY_FORMAT_VERSION) {
				this.logger.warn('Binary format version mismatch, regenerating data');
				return false;
			}

			this.logger.info(`Loading binary format data: ${indexData.shardCount} shards`);

			const allData: GeoDataEntry[] = [];

			for (let i = 0; i < indexData.shardCount; i++) {
				const shardPath = path.join(this.dataPath, `geodata_shard_${i}.bin`);
				const shardData = await this.readBinaryShard(shardPath);
				allData.push(...shardData);

				if (i % 10 === 0) {
					this.logger.info(`Loading progress: ${i + 1}/${indexData.shardCount} shards`);
				}
			}

			this.geoData = allData;
			this.buildSpatialIndex();

			this.logger.info(`Binary data loaded: ${allData.length} entries`);
			return true;
		} catch (error) {
			this.logger.warn('Failed to load binary format:', error as any);
			return false;
		}
	}

	@bindThis
	private async readBinaryShard(filePath: string): Promise<GeoDataEntry[]> {
		const compressedData = await fs.readFile(filePath);
		const buffer = zlib.gunzipSync(compressedData);

		const results: GeoDataEntry[] = [];
		let offset = 0;

		const version = buffer.readUInt32LE(offset);
		offset += 4;
		const recordCount = buffer.readUInt32LE(offset);
		offset += 4;

		if (version !== this.BINARY_FORMAT_VERSION) {
			throw new Error(`Shard version mismatch: ${version}`);
		}

		for (let i = 0; i < recordCount; i++) {
			const lat = buffer.readDoubleLE(offset);
			offset += 8;
			const lon = buffer.readDoubleLE(offset);
			offset += 8;

			const place_id = buffer.readUInt32LE(offset);
			offset += 4;
			const osm_id = buffer.readUInt32LE(offset);
			offset += 4;

			const importance = buffer.readFloatLE(offset);
			offset += 4;

			const levelCode = buffer.readUInt8(offset);
			offset += 1;
			const level = this.decodeLevelFromByte(levelCode);

			const nameLength = buffer.readUInt16LE(offset);
			offset += 2;
			offset += nameLength;

			const propsLength = buffer.readUInt16LE(offset);
			offset += 2;
			const propsJSON = buffer.subarray(offset, offset + propsLength).toString('utf-8');
			offset += propsLength;
			const properties = JSON.parse(propsJSON);

			results.push({
				lat, lon, place_id, osm_id, importance, level, properties,
				hash: this.generateDataHash(`${place_id}_${osm_id}`),
			});
		}

		return results;
	}

	private lastUpdateSequence = 0;

	@bindThis
	public async performIncrementalUpdate(): Promise<void> {
		if (this.syncInProgress) {
			this.logger.warn('Sync is already in progress, skipping incremental update');
			return;
		}

		this.syncInProgress = true;
		try {
			this.logger.info('Starting incremental update...');

			const latestSequence = await this.getLatestSequenceNumber();

			if (this.lastUpdateSequence === 0) {
				this.lastUpdateSequence = latestSequence;
				this.logger.info(`Initializing sequence number: ${latestSequence}`);
				return;
			}

			if (latestSequence <= this.lastUpdateSequence) {
				this.logger.info('No new updates');
				return;
			}

			const updatedEntries = await this.processIncrementalUpdates(
				this.lastUpdateSequence + 1,
				latestSequence
			);

			if (updatedEntries.length > 0) {
				await this.applyIncrementalUpdates(updatedEntries);

				if (this.elasticClient) {
					await this.updateElasticsearchIncremental(updatedEntries);
				}

				this.logger.info(`Incremental update completed: ${updatedEntries.length} records`);
			}

			this.lastUpdateSequence = latestSequence;
			await this.saveUpdateSequence();
		} catch (error) {
			this.logger.error('Incremental update failed:', (error as Error));
			throw error;
		} finally {
			this.syncInProgress = false;
		}
	}

	@bindThis
	private async getLatestSequenceNumber(): Promise<number> {
		try {
			const stateUrl = this.OSM_DATA_SOURCES.daily + 'state.txt';
			const response = await this.robustNetworkRequest<string>(stateUrl, {
				method: 'GET',
				timeout: 10000,
				maxRetries: 2
			});

			const lines = response.split('\n');
			for (const line of lines) {
				if (line.startsWith('sequenceNumber=')) {
					return parseInt(line.split('=')[1]);
				}
			}

			this.logger.warn('Unable to parse sequence number from response');
			return this.lastUpdateSequence;
		} catch (error) {
			this.logger.error(`Failed to retrieve sequence:`, (error as Error));
			return this.lastUpdateSequence;
		}
	}

	@bindThis
	private async processIncrementalUpdates(fromSequence: number, toSequence: number): Promise<GeoDataEntry[]> {
		const updatedEntries: GeoDataEntry[] = [];

		const maxBatchSize = 100;
		const endSequence = Math.min(toSequence, fromSequence + maxBatchSize - 1);

		for (let seq = fromSequence; seq <= endSequence; seq++) {
			try {
				const paddedSeq = seq.toString().padStart(9, '0');
				const changesetUrl = `${this.OSM_DATA_SOURCES.daily}${paddedSeq.slice(0, 3)}/${paddedSeq.slice(3, 6)}/${paddedSeq.slice(6)}.osc.gz`;

				const changes = await this.downloadAndProcessChangeset(changesetUrl);
				updatedEntries.push(...changes);

				await new Promise(resolve => setTimeout(resolve, 100));
			} catch (error) {
				this.logger.warn(`Failed to process sequence ${seq}:`, (error as Error));
			}
		}

		return updatedEntries;
	}

	@bindThis
	private async downloadAndProcessChangeset(url: string): Promise<GeoDataEntry[]> {
		try {
			const response = await this.robustNetworkRequest<string>(url, {
				method: 'GET',
				timeout: 60000,
				maxRetries: 3,
				headers: {
					'Accept-Encoding': 'gzip'
				}
			});
			const compressedData = Buffer.from(response, 'binary');

			const decompressedData = zlib.gunzipSync(compressedData);
			const xmlContent = decompressedData.toString('utf-8');

			return this.parseOSCXML(xmlContent);
		} catch (error) {
			this.logger.warn('Failed to download changeset:', error as any);
			return [];
		}
	}

	@bindThis
	private parseOSCXML(xmlContent: string): GeoDataEntry[] {
		const results: GeoDataEntry[] = [];

		const nodeMatches = xmlContent.match(/<node[^>]*>/g);
		if (!nodeMatches) return results;

		for (const nodeMatch of nodeMatches) {
			try {
				const latMatch = nodeMatch.match(/lat=["']([^"']+)["']/);
				const lonMatch = nodeMatch.match(/lon=["']([^"']+)["']/);
				const idMatch = nodeMatch.match(/id=["']([^"']+)["']/);

				if (!latMatch || !lonMatch || !idMatch) continue;

				const lat = parseFloat(latMatch[1]);
				const lon = parseFloat(lonMatch[1]);
				const osmId = parseInt(idMatch[1]);

				if (isNaN(lat) || isNaN(lon)) continue;

				if (this.hasGeoTags(xmlContent, osmId)) {
					const geoEntry = this.createGeoEntryFromOSM(lat, lon, osmId, xmlContent);
					if (geoEntry) {
						results.push(geoEntry);
					}
				}
			} catch (parseError) {
			}
		}

		return results;
	}

	@bindThis
	private hasGeoTags(xmlContent: string, osmId: number): boolean {
		const geoTags = ['place=', 'name=', 'amenity=', 'shop=', 'tourism='];
		const nodeSection = this.extractNodeSection(xmlContent, osmId);

		return geoTags.some(tag => nodeSection.includes(tag));
	}

	@bindThis
	private extractNodeSection(xmlContent: string, osmId: number): string {
		const nodeStartRegex = new RegExp(`<node[^>]*id=["']${osmId}["'][^>]*>`);
		const startMatch = xmlContent.match(nodeStartRegex);
		if (!startMatch) return '';

		const startIndex = xmlContent.indexOf(startMatch[0]);
		const endIndex = xmlContent.indexOf('</node>', startIndex);

		if (endIndex === -1) return startMatch[0];

		return xmlContent.slice(startIndex, endIndex + 7);
	}

	@bindThis
	private createGeoEntryFromOSM(lat: number, lon: number, osmId: number, xmlContent: string): GeoDataEntry | null {
		const nodeSection = this.extractNodeSection(xmlContent, osmId);

		const tags = this.extractTags(nodeSection);
		if (Object.keys(tags).length === 0) return null;

		const level = this.determineOSMLevel(tags);

		return {
			lat,
			lon,
			properties: {
				name: tags.name || tags['name:en'] || '',
				display_name: tags.name || tags['name:en'] || `OSM Node ${osmId}`,
				...tags,
			},
			level,
			importance: this.calculateOSMImportance(tags),
			place_id: osmId,
			osm_id: osmId,
			hash: this.generateDataHash(`osm_${osmId}`),
		};
	}

	@bindThis
	private extractTags(nodeSection: string): Record<string, string> {
		const tags: Record<string, string> = {};
		const tagMatches = nodeSection.match(/<tag[^>]*>/g);

		if (tagMatches) {
			for (const tagMatch of tagMatches) {
				const keyMatch = tagMatch.match(/k=["']([^"']+)["']/);
				const valueMatch = tagMatch.match(/v=["']([^"']*)["']/);

				if (keyMatch && valueMatch) {
					tags[keyMatch[1]] = valueMatch[1];
				}
			}
		}

		return tags;
	}

	@bindThis
	private determineOSMLevel(tags: Record<string, string>): GeoDataEntry['level'] {
		if (tags.place) {
			switch (tags.place) {
				case 'country': return 'country';
				case 'state': case 'province': return 'state';
				case 'city': return 'city';
				case 'town': return 'town';
				case 'village': case 'hamlet': return 'village';
				case 'county': return 'county';
				default: return 'district';
			}
		}
		return 'district';
	}

	@bindThis
	private calculateOSMImportance(tags: Record<string, string>): number {
		let importance = 0;

		if (tags.place) importance += 0.5;
		if (tags.name) importance += 0.3;
		if (tags.amenity) importance += 0.2;
		if (tags.tourism) importance += 0.1;

		if (tags.population) {
			const population = parseInt(tags.population);
			if (!isNaN(population)) {
				importance += Math.log10(population) / 10;
			}
		}

		return Math.min(importance, 1);
	}

	@bindThis
	private async applyIncrementalUpdates(updates: GeoDataEntry[]): Promise<void> {
		for (const update of updates) {
			const existingIndex = this.geoData.findIndex(entry => entry.osm_id === update.osm_id);

			if (existingIndex >= 0) {
				this.geoData[existingIndex] = update;
			} else {
				this.geoData.push(update);
			}
		}

		this.buildSpatialIndex();
	}

	@bindThis
	private async updateElasticsearchIncremental(updates: GeoDataEntry[]): Promise<void> {
		if (!this.elasticClient) return;

		const indexName = this.ES_INDEX_PREFIX;
		const body = [];

		for (const update of updates) {
			body.push({ index: { _index: indexName, _id: update.place_id.toString() } });
			body.push({
				location: { lat: update.lat, lon: update.lon },
				bounds: update.bounds ? {
					type: 'envelope',
					coordinates: [[update.bounds[1], update.bounds[2]], [update.bounds[3], update.bounds[0]]]
				} : undefined,
				...update,
			});
		}

		if (body.length > 0) {
			await this.elasticClient.bulk({ body });
		}
	}

	@bindThis
	private async saveUpdateSequence(): Promise<void> {
		const sequenceFile = path.join(this.dataPath, 'last_sequence.txt');
		await fs.writeFile(sequenceFile, this.lastUpdateSequence.toString(), 'utf-8');
	}
}
