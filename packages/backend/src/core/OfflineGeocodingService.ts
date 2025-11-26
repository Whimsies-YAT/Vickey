/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import * as fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { LoggerService } from '@/core/LoggerService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { DownloadService } from '@/core/DownloadService.js';
import { createReadStream } from 'node:fs';
import { EventEmitter } from 'node:events';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import * as os from "os";
import { ZipReader } from 'slacc';
import { createOSMStream } from 'osm-pbf-parser-node';

interface OSMNode {
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
	type: 'node';
}

interface OSMWay {
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
	nodes: number[];
	type: 'way';
}

interface OSMRelation {
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
	members: Array<{
		type: 'node' | 'way' | 'relation';
		ref: number;
		role: string;
	}>;
	type: 'relation';
}

type OSMItem = OSMNode | OSMWay | OSMRelation;

declare module 'osm-pbf-parser-node' {
	function createOSMStream(filePath: string, options?: { withTags?: boolean; withInfo?: boolean }): AsyncIterable<OSMItem>;
}

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

interface MemoryStats {
	heapUsed: number;
	heapTotal: number;
	external: number;
	rss: number;
	timestamp: number;
}

interface OperationResult<T = any> {
	success: boolean;
	data?: T;
	error?: Error;
	metrics?: {
		duration: number;
		memoryUsage: number;
		operationsCount?: number;
	};
}

interface AtomicOperationContext {
	id: string;
	type: 'download' | 'process' | 'index' | 'save';
	startTime: number;
	isCancellable: boolean;
	cancel?: () => void;
	cleanup?: () => Promise<void>;
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
export class OfflineGeocodingService implements OnApplicationShutdown, OnApplicationBootstrap {
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
	private readonly maxMemoryUsage: number;
	private readonly MEMORY_USAGE_RATIO = 0.4;
	private readonly MIN_MEMORY_LIMIT = 256 * 1024 * 1024;
	private readonly MAX_MEMORY_LIMIT = 2 * 1024 * 1024 * 1024;

	private readonly MIN_VALID_LAT = -90;
	private readonly MAX_VALID_LAT = 90;
	private readonly MIN_VALID_LON = -180;
	private readonly MAX_VALID_LON = 180;
	private readonly MIN_IMPORTANCE = 0;
	private readonly MAX_IMPORTANCE = 1;
	private readonly MAX_NAME_LENGTH = 500;
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
	private readonly ES_INDEX_PREFIX: string;
	private memoryMonitor: NodeJS.Timeout | null = null;
	private activeTimeouts = new Set<NodeJS.Timeout>();
	private activeIntervals = new Set<NodeJS.Timeout>();
	private processListeners = new Map<string, (...args: any[]) => void>();
	private readonly eventEmitter = new EventEmitter();
	private memoryStats: MemoryStats[] = [];
	private readonly MAX_MEMORY_STATS_HISTORY = 100;
	private activeOperations = new Map<string, AtomicOperationContext>();
	private criticalMemoryMode = false;
	private lastGcTime = 0;
	private readonly MEMORY_MONITOR_INTERVAL = 5000;
	private readonly MEMORY_WARNING_THRESHOLD = 0.85;
	private readonly MEMORY_CRITICAL_THRESHOLD = 0.95;
	private readonly GC_COOLDOWN = 30000;
	private readonly MAX_CONCURRENT_OPERATIONS = 3;
	private gracefulShutdown = false;
	private readonly SHUTDOWN_GRACE_PERIOD = 30000;
	private readonly operationTimeouts = new Map<string, NodeJS.Timeout>();
	private currentMemoryPressure = 0;
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
		const filesDir = path.join(process.cwd(), '../../files');
		this.dataPath = path.join(filesDir, 'geoData');
		this.syncDataPath = path.join(filesDir, 'geoData-sync');

		this.ES_INDEX_PREFIX = (this.config.elasticsearch?.index || 'Vickey') + 'VkGeocoding';

		this.maxMemoryUsage = this.calculateOptimalMemoryLimit();
		this.logger.info(`Initialized with dynamic memory limit: ${Math.round(this.maxMemoryUsage / 1024 / 1024)}MB`);

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

		this.initializeResourceManagement();
		this.setupGracefulShutdownHandling();
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
	private async filterAndValidateData(entries: Partial<GeoDataEntry>[]): Promise<GeoDataEntry[]> {
		const validEntries: GeoDataEntry[] = [];
		const seenCoordinates = new Set<string>();

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
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

			// Yield control every 1000 entries to prevent call stack overflow
			if (i % 1000 === 0) {
				await new Promise(resolve => setImmediate(resolve));
			}
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

					if (typeof response === 'object' && response && 'text' in response) {
						const contentType = response.headers?.get?.('content-type') || '';
						const isGzipped = contentType.includes('gzip') || url.endsWith('.gz');
						const isBinary = isGzipped || contentType.includes('application/octet-stream') || contentType.includes('application/x-gzip');

						if (isBinary) {
							const arrayBuffer = await response.arrayBuffer();
							const buffer = Buffer.from(arrayBuffer);
							return buffer as T;
						} else {
							const textContent = await response.text();
							return textContent as T;
						}
					}

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
		try {
			this.logger.info('Starting decompression with slacc');
			const zipBuffer = await fs.readFile(zipPath);
			ZipReader.withDestinationPath(path.dirname(outputPath)).viaBuffer(zipBuffer);
			this.logger.info('Stream decompression completed');
		} catch (error: any) {
			this.logger.error('Stream decompression failed:', error);
			throw error;
		}
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

		try {
			const optimizedData = await this.loadGeoDataFromFile('cities_optimized.json');
			if (optimizedData.length > 0) {
				this.geoData = optimizedData;

				try {
					const indexPath = path.join(this.dataPath, 'spatial_index.json');
					const indexData = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
					this.spatialIndex = new Map(indexData);
					console.log(`Loaded precomputed spatial index with ${this.spatialIndex.size} grid cells`);
				} catch (indexError) {
					this.buildSpatialIndex();
				}

				this.isInitialized = true;
				console.log(`Offline geocoding initialized with optimized data: ${this.geoData.length} entries`);
				return;
			}
		} catch (error) {
			console.log('No optimized data found, trying legacy format...');
		}

		const dataFiles = [
			'cities_world.json',
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
				maxMemoryUsage: `${Math.round(this.maxMemoryUsage / 1024 / 1024)}MB`,
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
		if (memUsage.heapUsed > this.maxMemoryUsage * 0.8) {
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
			for (const result of batchResults) {
				results.push(result);
			}
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
	public async *streamGeocodingResults(
		query: { lat?: number; lon?: number; radius?: number; name?: string },
		options: { pageSize?: number; maxResults?: number } = {}
	): AsyncGenerator<GeocodingResult[], void, unknown> {
		try {
			await this.initialize();

			const { pageSize = 1000, maxResults = Infinity } = options;

			if (pageSize <= 0 || maxResults <= 0) {
				throw new Error('pageSize and maxResults must be positive numbers');
			}

			if (query.lat !== undefined && query.lon !== undefined) {
				if (isNaN(query.lat) || isNaN(query.lon) ||
					Math.abs(query.lat) > 90 || Math.abs(query.lon) > 180) {
					throw new Error('Invalid latitude or longitude coordinates');
				}
				yield* this.streamByProximity(query.lat, query.lon, query.radius || 1, pageSize, maxResults);
			} else if (query.name) {
				if (!query.name || query.name.trim().length === 0) {
					throw new Error('Search name must be a non-empty string');
				}
				yield* this.streamByName(query.name.trim(), pageSize, maxResults);
			} else {
				yield* this.streamAllData(pageSize, maxResults);
			}
		} catch (error) {
			this.logger.error('Error in streamGeocodingResults:', error as Error);
			throw error;
		}
	}

	@bindThis
	private async *streamByProximity(
		lat: number,
		lon: number,
		radius: number,
		pageSize: number,
		maxResults: number
	): AsyncGenerator<GeocodingResult[], void, unknown> {
		try {
			if (radius <= 0 || radius > 20000) {
				throw new Error('Radius must be between 0 and 20000 km');
			}

			const gridKeys = this.getProximityGridKeys(lat, lon, radius);
			let processed = 0;
			let batch: GeocodingResult[] = [];
			const radiusSquared = radius * radius;

			const candidateQueue: Array<{ entry: GeoDataEntry; distance: number; score: number }> = [];
			const QUEUE_SIZE_LIMIT = Math.min(maxResults * 2, 1000);

			const sortedGridKeys = this.sortGridKeysByProximity(gridKeys, lat, lon);

			for (const gridKey of sortedGridKeys) {
				if (processed >= maxResults) break;

				try {
					const entries = this.spatialIndex.get(gridKey) || [];
					for (const entry of entries) {
						try {
							const distanceSquared = this.calculateDistanceSquared(lat, lon, entry.lat, entry.lon);
							if (distanceSquared <= radiusSquared) {
								const actualDistance = Math.sqrt(distanceSquared);
								const score = this.calculateProximityScore(entry, actualDistance);

								this.insertSortedByScore(candidateQueue, { entry, distance: actualDistance, score }, QUEUE_SIZE_LIMIT);
							}
						} catch (entryError) {
							this.logger.warn('Error processing entry:', entryError as Error);
						}
					}

					if (candidateQueue.length >= pageSize && processed < maxResults) {
						const resultsToYield = Math.min(pageSize, maxResults - processed, candidateQueue.length);

						for (let i = 0; i < resultsToYield; i++) {
							const candidate = candidateQueue.shift();
							if (!candidate) break;

							try {
								const result = this.convertToGeocodingResult(candidate.entry);
								batch.push(result);
								processed++;
							} catch (resultError) {
								this.logger.warn('Error converting result:', resultError as Error);
							}
						}

						if (batch.length > 0) {
							yield batch;
							batch = [];
						}

						if (processed % (pageSize * 2) === 0) {
							await new Promise(resolve => setImmediate(resolve));
						}
					}
				} catch (gridError) {
					this.logger.warn(`Error processing grid ${gridKey}:`, gridError as Error);
				}
			}

			while (candidateQueue.length > 0 && processed < maxResults) {
				const candidate = candidateQueue.shift();
				if (!candidate) break;

				try {
					const result = this.convertToGeocodingResult(candidate.entry);
					batch.push(result);
					processed++;

					if (batch.length >= pageSize) {
						yield batch;
						batch = [];
					}
				} catch (resultError) {
					this.logger.warn('Error converting result:', resultError as Error);
				}
			}

			if (batch.length > 0) {
				yield batch;
			}
		} catch (error) {
			this.logger.error('Error in streamByProximity:', error as Error);
			throw error;
		}
	}

	@bindThis
	private async *streamByName(
		name: string,
		pageSize: number,
		maxResults: number
	): AsyncGenerator<GeocodingResult[], void, unknown> {
		try {
			const searchTerm = name.toLowerCase();
			let processed = 0;
			let batch: GeocodingResult[] = [];

			const searchLength = searchTerm.length;
			const isExactMatch = searchLength <= 3;

			let priorityEntries: GeoDataEntry[];

			try {
				priorityEntries = this.geoData
					.filter(entry => {
						try {
							const name = entry.properties.name?.toLowerCase();
							if (!name) return false;

							if (name === searchTerm) return true;

							if (isExactMatch && !name.startsWith(searchTerm)) return false;

							return name.includes(searchTerm) ||
								   entry.properties.city?.toLowerCase().includes(searchTerm) ||
								   entry.properties.admin1?.toLowerCase().includes(searchTerm);
						} catch (filterError) {
							this.logger.warn('Error filtering entry:', filterError as Error);
							return false;
						}
					})
					.sort((a, b) => {
						try {
							const scoreA = this.calculateNameScore(a, searchTerm);
							const scoreB = this.calculateNameScore(b, searchTerm);
							return scoreB - scoreA;
						} catch (sortError) {
							this.logger.warn('Error sorting entries:', sortError as Error);
							return 0;
						}
					});
			} catch (processingError) {
				this.logger.error('Error processing search data:', processingError as Error);
				priorityEntries = [];
			}

			for (const entry of priorityEntries) {
				if (processed >= maxResults) break;

				try {
					const result = this.convertToGeocodingResult(entry);
					batch.push(result);
					processed++;

					if (batch.length >= pageSize) {
						yield batch;
						batch = [];

						if (processed % (pageSize * 5) === 0) {
							await new Promise(resolve => setImmediate(resolve));
						}
					}
				} catch (resultError) {
					this.logger.warn('Error converting entry to result:', resultError as Error);
				}
			}

			if (batch.length > 0) {
				yield batch;
			}
		} catch (error) {
			this.logger.error('Error in streamByName:', error as Error);
			throw error;
		}
	}

	@bindThis
	private async *streamAllData(
		pageSize: number,
		maxResults: number
	): AsyncGenerator<GeocodingResult[], void, unknown> {
		try {
			let processed = 0;
			let batch: GeocodingResult[] = [];

			const chunkSize = 5000;
			for (let i = 0; i < this.geoData.length && processed < maxResults; i += chunkSize) {
				try {
					const chunk = this.geoData.slice(i, Math.min(i + chunkSize, this.geoData.length));

					for (const entry of chunk) {
						if (processed >= maxResults) break;

						try {
							const result = this.convertToGeocodingResult(entry);
							batch.push(result);
							processed++;

							if (batch.length >= pageSize) {
								yield batch;
								batch = [];
							}
						} catch (entryError) {
							this.logger.warn('Error processing entry in streamAllData:', entryError as Error);
						}
					}

					await new Promise(resolve => setImmediate(resolve));
				} catch (chunkError) {
					this.logger.warn(`Error processing chunk ${i}-${i + chunkSize}:`, chunkError as Error);
				}
			}

			if (batch.length > 0) {
				yield batch;
			}
		} catch (error) {
			this.logger.error('Error in streamAllData:', error as Error);
			throw error;
		}
	}

	@bindThis
	public async getPaginatedResults(
		query: { lat?: number; lon?: number; radius?: number; name?: string },
		page: number = 1,
		pageSize: number = 50
	): Promise<{
		results: GeocodingResult[];
		pagination: {
			page: number;
			pageSize: number;
			total: number;
			totalPages: number;
			hasNext: boolean;
			hasPrev: boolean;
		};
	}> {
		await this.initialize();

		const skipCount = (page - 1) * pageSize;
		const stream = this.streamGeocodingResults(query, {
			pageSize: pageSize,
			maxResults: pageSize + skipCount
		});

		const allResults: GeocodingResult[] = [];
		let totalProcessed = 0;

		for await (const batch of stream) {
			if (totalProcessed + batch.length <= skipCount) {
				totalProcessed += batch.length;
				continue;
			}

			const startIdx = Math.max(0, skipCount - totalProcessed);
			const endIdx = Math.min(batch.length, startIdx + (pageSize - allResults.length));

			allResults.push(...batch.slice(startIdx, endIdx));
			totalProcessed += batch.length;

			if (allResults.length >= pageSize) {
				break;
			}
		}

		const total = await this.estimateTotalResults(query);
		const totalPages = Math.ceil(total / pageSize);

		return {
			results: allResults,
			pagination: {
				page,
				pageSize,
				total,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1,
			},
		};
	}

	@bindThis
	private async estimateTotalResults(query: { lat?: number; lon?: number; radius?: number; name?: string }): Promise<number> {
		if (query.lat !== undefined && query.lon !== undefined) {
			const radius = query.radius || 1;
			const gridKeys = this.getProximityGridKeys(query.lat, query.lon, radius);

			let estimate = 0;
			for (const gridKey of gridKeys) {
				const count = this.gridStats.get(gridKey) || 0;
				estimate += count;
			}

			return Math.min(estimate, this.geoData.length);
		} else if (query.name) {
			const sampleSize = Math.min(1000, this.geoData.length);
			const sample = this.geoData.slice(0, sampleSize);
			const searchTerm = query.name.toLowerCase();

			let matches = 0;
			for (const entry of sample) {
				if (this.calculateNameScore(entry, searchTerm) > 0) {
					matches++;
				}
			}

			const ratio = matches / sampleSize;
			return Math.floor(this.geoData.length * ratio);
		}

		return this.geoData.length;
	}

	@bindThis
	private calculateNameScore(entry: GeoDataEntry, searchTerm: string): number {
		let score = 0;

		const name = entry.properties.name?.toLowerCase();
		const city = entry.properties.city?.toLowerCase();
		const admin1 = entry.properties.admin1?.toLowerCase();
		const admin2 = entry.properties.admin2?.toLowerCase();
		const country = entry.properties.country_code?.toLowerCase();

		if (name === searchTerm) {
			score += 100;
		} else if (name?.startsWith(searchTerm)) {
			score += 80;
		} else if (name?.includes(searchTerm)) {
			score += 50;
		}

		if (city?.includes(searchTerm)) score += 30;
		else if (admin1?.includes(searchTerm)) score += 15;
		else if (admin2?.includes(searchTerm)) score += 10;
		else if (country?.includes(searchTerm)) score += 5;

		if (score > 0) {
			score += Math.min(entry.importance * 10, 20);

			if (entry.population && entry.population > 100000) score += 15;
			else if (entry.population && entry.population > 10000) score += 8;
			else if (entry.population && entry.population > 1000) score += 3;
		}

		return score;
	}

	@bindThis
	private getProximityGridKeys(lat: number, lon: number, radius: number): string[] {
		const gridKeys = new Set<string>();

		const latMin = lat - radius;
		const latMax = lat + radius;
		const lonMin = lon - radius;
		const lonMax = lon + radius;

		const gridLatMin = Math.floor(latMin / this.GRID_SIZE) * this.GRID_SIZE;
		const gridLatMax = Math.ceil(latMax / this.GRID_SIZE) * this.GRID_SIZE;
		const gridLonMin = Math.floor(lonMin / this.GRID_SIZE) * this.GRID_SIZE;
		const gridLonMax = Math.ceil(lonMax / this.GRID_SIZE) * this.GRID_SIZE;

		for (let gridLat = gridLatMin; gridLat <= gridLatMax; gridLat += this.GRID_SIZE) {
			for (let gridLon = gridLonMin; gridLon <= gridLonMax; gridLon += this.GRID_SIZE) {
				const key = `${gridLat.toFixed(1)}_${gridLon.toFixed(1)}`;
				gridKeys.add(key);
			}
		}

		return Array.from(gridKeys);
	}

	@bindThis
	private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371;
		const dLat = (lat2 - lat1) * Math.PI / 180;
		const dLon = (lon2 - lon1) * Math.PI / 180;
		const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	@bindThis
	private calculateProximityScore(entry: GeoDataEntry, distance: number): number {
		const distanceScore = Math.max(0, 100 - distance);
		const importanceScore = entry.importance * 50;
		const populationScore = entry.population ? Math.log10(entry.population) : 0;

		return distanceScore + importanceScore + populationScore;
	}

	@bindThis
	private sortGridKeysByProximity(gridKeys: string[], centerLat: number, centerLon: number): string[] {
		return gridKeys.sort((a, b) => {
			const aParts = a.split('_');
			const bParts = b.split('_');

			if (aParts.length !== 3 || bParts.length !== 3) {
				return 0;
			}

			const [aLevel, aLatIndex, aLonIndex] = aParts.map(Number);
			const [bLevel, bLatIndex, bLonIndex] = bParts.map(Number);

			const aGridLevel = (aLevel >= 0 && aLevel < this.GRID_LEVELS.length) ? this.GRID_LEVELS[aLevel] : this.GRID_LEVELS[0];
			const bGridLevel = (bLevel >= 0 && bLevel < this.GRID_LEVELS.length) ? this.GRID_LEVELS[bLevel] : this.GRID_LEVELS[0];
			const aGridSize = aGridLevel.size;
			const bGridSize = bGridLevel.size;

			if (isNaN(aLatIndex) || isNaN(aLonIndex) || isNaN(bLatIndex) || isNaN(bLonIndex)) {
				return 0;
			}

			const aLat = aLatIndex * aGridSize;
			const aLon = aLonIndex * aGridSize;
			const bLat = bLatIndex * bGridSize;
			const bLon = bLonIndex * bGridSize;

			const aDist = this.calculateDistanceSquared(centerLat, centerLon, aLat, aLon);
			const bDist = this.calculateDistanceSquared(centerLat, centerLon, bLat, bLon);

			return aDist - bDist;
		});
	}

	@bindThis
	private insertSorted<T extends { score: number }>(
		array: T[],
		item: T,
		maxSize: number
	): void {
		let low = 0;
		let high = array.length;

		while (low < high) {
			const mid = Math.floor((low + high) / 2);
			if (array[mid].score > item.score) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		array.splice(low, 0, item);

		if (array.length > maxSize) {
			array.length = maxSize;
		}
	}

	@bindThis
	private insertSortedByScore<T extends { score: number }>(
		array: T[],
		item: T,
		maxSize: number
	): void {
		if (array.length < maxSize || item.score > array[array.length - 1].score) {
			this.insertSorted(array, item, maxSize);
		}
	}

	@bindThis
	private calculateDistanceSquared(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const dLat = lat2 - lat1;
		const dLon = lon2 - lon1;
		const latDist = dLat * 111;
		const lonDist = dLon * 111 * Math.cos(lat1 * Math.PI / 180);
		return latDist * latDist + lonDist * lonDist;
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

		if (this.syncInProgress) {
			this.logger.debug('Geocoding query blocked during synchronization');
			return this.createEmptyGeoJson(lat, lon);
		}

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
	private initializeMemoryMonitoring(): void {
		if (this.memoryMonitor) {
			clearInterval(this.memoryMonitor);
			this.activeIntervals.delete(this.memoryMonitor);
		}

		this.memoryMonitor = setInterval(() => {
			try {
				const memUsage = process.memoryUsage();
				const memStats: MemoryStats = {
					heapUsed: memUsage.heapUsed,
					heapTotal: memUsage.heapTotal,
					external: memUsage.external,
					rss: memUsage.rss,
					timestamp: Date.now()
				};

				this.memoryStats.push(memStats);
				if (this.memoryStats.length > this.MAX_MEMORY_STATS_HISTORY) {
					this.memoryStats.shift();
				}

				const usageRatio = memUsage.heapUsed / this.maxMemoryUsage;

				if (usageRatio > this.MEMORY_CRITICAL_THRESHOLD) {
					if (!this.criticalMemoryMode) {
						this.criticalMemoryMode = true;
						this.logger.error(`Critical memory usage: ${Math.round(usageRatio * 100)}%`);
						this.handleCriticalMemory();
					}
				} else if (usageRatio > this.MEMORY_WARNING_THRESHOLD) {
					this.logger.warn(`High memory usage: ${Math.round(usageRatio * 100)}%`);
					this.eventEmitter.emit('memory:warning', memStats);
					this.handleHighMemory();
				} else if (this.criticalMemoryMode && usageRatio < this.MEMORY_WARNING_THRESHOLD) {
					this.criticalMemoryMode = false;
					this.logger.info('Memory usage returned to normal levels');
					this.eventEmitter.emit('memory:normal', memStats);
				}
			} catch (error) {
				this.logger.error('Error in memory monitoring:', error as Error);
			}
		}, this.MEMORY_MONITOR_INTERVAL);

		this.activeIntervals.add(this.memoryMonitor);
	}

	@bindThis
	private setupErrorHandling(): void {
		this.eventEmitter.removeAllListeners();
		this.cleanupProcessListeners();

		this.eventEmitter.on('memory:critical', () => {
			this.pauseNonCriticalOperations();
		});

		this.eventEmitter.on('memory:warning', () => {
			this.optimizeMemoryUsage();
		});

		const uncaughtExceptionHandler = (error: Error) => {
			this.logger.error('Uncaught exception in OfflineGeocodingService:', error);
			this.eventEmitter.emit('error:uncaught', error);
		};

		const unhandledRejectionHandler = (reason: any, promise: Promise<any>) => {
			this.logger.error('Unhandled promise rejection in OfflineGeocodingService:', reason);
			this.eventEmitter.emit('error:unhandled', { reason, promise });
		};

		process.on('uncaughtException', uncaughtExceptionHandler);
		process.on('unhandledRejection', unhandledRejectionHandler);

		this.processListeners.set('uncaughtException', uncaughtExceptionHandler);
		this.processListeners.set('unhandledRejection', unhandledRejectionHandler);
	}

	@bindThis
	private handleCriticalMemory(): void {
		this.logger.error('Entering critical memory mode - pausing operations');

		this.cache.clear();
		this.precomputedResults.clear();

		this.forceGarbageCollection();

		for (const [operationId, operation] of this.activeOperations) {
			if (operation.isCancellable) {
				this.logger.warn(`Cancelling operation due to memory pressure: ${operationId}`);
				if (operation.cancel) {
					operation.cancel();
				}
			}
		}
	}

	@bindThis
	private handleHighMemory(): void {
		if (this.cache.size > this.MAX_CACHE_SIZE * 0.5) {
			const entriesToRemove = this.cache.size - Math.floor(this.MAX_CACHE_SIZE * 0.3);
			const keysToRemove = Array.from(this.cache.keys()).slice(0, entriesToRemove);
			keysToRemove.forEach(key => this.cache.delete(key));
			this.logger.info(`Cleared ${entriesToRemove} cache entries to free memory`);
		}

		if (this.precomputedResults.size > 1000) {
			const entriesToRemove = this.precomputedResults.size - 500;
			const keysToRemove = Array.from(this.precomputedResults.keys()).slice(0, entriesToRemove);
			keysToRemove.forEach(key => this.precomputedResults.delete(key));
			this.logger.info(`Cleared ${entriesToRemove} precomputed results to free memory`);
		}

		this.forceGarbageCollection();
	}

	@bindThis
	private forceGarbageCollection(): void {
		const now = Date.now();
		if (now - this.lastGcTime > this.GC_COOLDOWN && global.gc) {
			this.lastGcTime = now;
			const before = process.memoryUsage().heapUsed;
			global.gc();
			const after = process.memoryUsage().heapUsed;
			const freed = before - after;
			if (freed > 0) {
				this.logger.info(`Garbage collection freed ${Math.round(freed / 1024 / 1024)}MB`);
			}
		}
	}

	@bindThis
	private pauseNonCriticalOperations(): void {
		this.logger.warn('Pausing non-critical operations due to memory pressure');
	}

	@bindThis
	private optimizeMemoryUsage(): void {
		if (this.geoData.length > 1000000) {
			this.logger.info('Large dataset detected, considering data sharding');
		}
	}

	@bindThis
	public getMemoryStats(): {
		current: MemoryStats;
		history: MemoryStats[];
		criticalMode: boolean;
		activeOperations: number;
	} {
		const current = process.memoryUsage();
		return {
			current: {
				heapUsed: current.heapUsed,
				heapTotal: current.heapTotal,
				external: current.external,
				rss: current.rss,
				timestamp: Date.now()
			},
			history: [...this.memoryStats],
			criticalMode: this.criticalMemoryMode,
			activeOperations: this.activeOperations.size
		};
	}

	@bindThis
	private async executeWithMemoryCheck<T>(
		operationType: AtomicOperationContext['type'],
		operation: () => Promise<T>,
		options: { timeout?: number; cancellable?: boolean } = {}
	): Promise<OperationResult<T>> {
		const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const startTime = Date.now();
		const startMemory = process.memoryUsage().heapUsed;

		if (this.criticalMemoryMode && operationType !== 'save') {
			return {
				success: false,
				error: new Error('Operation rejected due to critical memory conditions')
			};
		}

		const context: AtomicOperationContext = {
			id: operationId,
			type: operationType,
			startTime,
			isCancellable: options.cancellable ?? true
		};

		let timeoutId: NodeJS.Timeout | undefined;
		if (options.timeout) {
			timeoutId = setTimeout(() => {
				context.cancel?.();
			}, options.timeout);
		}

		this.activeOperations.set(operationId, context);

		try {
			const result = await operation();
			const endTime = Date.now();
			const endMemory = process.memoryUsage().heapUsed;

			return {
				success: true,
				data: result,
				metrics: {
					duration: endTime - startTime,
					memoryUsage: endMemory - startMemory
				}
			};
		} catch (error) {
			return {
				success: false,
				error: error as Error,
				metrics: {
					duration: Date.now() - startTime,
					memoryUsage: process.memoryUsage().heapUsed - startMemory
				}
			};
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			this.activeOperations.delete(operationId);
		}
	}

	@bindThis
	public async onApplicationBootstrap(): Promise<void> {
		if (!this.config.offlineGeocoding) {
			return;
		}

		const configValidation = this.validateOfflineGeocodingConfig();
		if (!configValidation.isValid) {
			this.logger.error('Invalid offline geocoding configuration:', configValidation.errors);
			this.logger.error('Please ensure your configuration includes the required fields:');
			this.logger.error('offlineGeocoding:');
			this.logger.error('  downloadFullGeoNames: true/false');
			this.logger.error('  includeAlternateNames: true/false');
			this.logger.error('  downloadOSM: true/false');
			return;
		}

		this.logger.info('Checking for existing offline geocoding data...');

		try {
			const hasExistingData = await this.loadFromBinaryFormat();

			if (hasExistingData) {
				this.logger.info('Existing offline geocoding data loaded successfully');
				this.checkAndDownloadMissingData().catch(error => {
					this.logger.error('Failed to check and download missing data:', error as Error);
				});
				return;
			}

			const geoNamesDataFiles = [
				'cities_world.json',
				'administrative_divisions.json',
				'poi_data.json',
				'cities_optimized.json'
			];

			let hasGeoNamesData = false;
			for (const filename of geoNamesDataFiles) {
				try {
					const filePath = path.join(this.dataPath, filename);
					await fs.access(filePath);
					const stats = await fs.stat(filePath);
					if (stats.size > 0) {
						hasGeoNamesData = true;
						break;
					}
				} catch (error) {
				}
			}

			if (hasGeoNamesData) {
				this.logger.info('Found existing GeoNames data files');
				await this.initialize();
				this.checkAndDownloadMissingData().catch(error => {
					this.logger.error('Failed to check and download missing data:', error as Error);
				});
				return;
			}

			this.logger.info('No existing offline geocoding data found. Starting immediate download...');

			this.startInitialDownload().catch(error => {
				this.logger.error('Initial offline geocoding data download failed:', error as any);
			});
		} catch (error) {
			this.logger.error('Error during offline geocoding initialization:', error as any);
		}
	}

	@bindThis
	private async startInitialDownload(): Promise<void> {
		if (this.syncInProgress) {
			this.logger.info('Sync already in progress, skipping initial download');
			return;
		}

		const result = await this.executeWithMemoryCheck('download', async () => {
			this.syncInProgress = true;
			try {
				this.logger.info('Starting initial offline geocoding data download...');

				await this.ensureDirectory(this.syncDataPath);

				const newGeoData = await this.downloadOfflineGeoData();

				if (newGeoData.length > 0) {
					const optimizedData = await this.optimizeGeoData(newGeoData);

					this.geoData = optimizedData;
					this.buildSpatialIndex();

					await this.ensureDataDirectory();

					if (optimizedData.length > this.COMPRESS_THRESHOLD && !this.elasticClient) {
						await this.convertToBinaryFormat(optimizedData);
					} else {
						await this.saveOptimizedDataAsJSON(optimizedData);
					}

					this.logger.info(`Initial offline geocoding data download completed: ${optimizedData.length} entries`);
					return optimizedData;
				} else {
					this.logger.warn('Initial download completed but no data was obtained');
					return [];
				}
			} catch (error) {
				this.logger.error('Initial download failed:', error as any);
				throw error;
			} finally {
				this.syncInProgress = false;
			}
		}, { timeout: 1800000, cancellable: true });

		if (!result.success) {
			this.logger.error('Initial download operation failed:', result.error);
			if (result.metrics) {
				this.logger.info(`Operation metrics - Duration: ${result.metrics.duration}ms, Memory used: ${Math.round(result.metrics.memoryUsage / 1024 / 1024)}MB`);
			}
			this.eventEmitter.emit('download:failed', result.error);
		} else {
			this.eventEmitter.emit('download:completed', result.data);
		}
	}

	@bindThis
	public async onApplicationShutdown(): Promise<void> {
		await this.performShutdown();
	}

	@bindThis
	private async performShutdown(): Promise<void> {
		if (this.gracefulShutdown) {
			return;
		}

		this.gracefulShutdown = true;
		this.logger.info('Starting OfflineGeocodingService shutdown...');

		const shutdownTimer = setTimeout(() => {
			this.logger.error('Shutdown timeout exceeded, forcing exit');
			process.exit(1);
		}, this.SHUTDOWN_GRACE_PERIOD);

		try {
			this.syncInProgress = true;

			if (this.memoryMonitor) {
				clearInterval(this.memoryMonitor);
				this.memoryMonitor = null;
			}

			if (this.activeOperations.size > 0) {
				this.logger.info(`Cancelling ${this.activeOperations.size} active operations...`);

				const cancelPromises = Array.from(this.activeOperations.entries()).map(
					async ([operationId, operation]) => {
						try {
							if (operation.cancel) operation.cancel();
							if (operation.cleanup) await operation.cleanup();
						} catch (error) {
							this.logger.warn(`Error cancelling operation ${operationId}:`, error as Error);
						}
					}
				);

				await Promise.allSettled(cancelPromises);
				this.activeOperations.clear();
			}

			if (this.workerPool.length > 0) {
				await Promise.allSettled(
					this.workerPool.map(worker => worker.terminate())
				);
				this.workerPool = [];
			}

			this.cleanupAllTimers();
			this.cleanupProcessListeners();
			this.eventEmitter.removeAllListeners();

			this.logger.info('OfflineGeocodingService shutdown complete');
		} catch (error) {
			this.logger.error('Error during shutdown:', error as Error);
		} finally {
			clearTimeout(shutdownTimer);
			this.activeTimeouts.delete(shutdownTimer);
		}
	}

	@bindThis
	private cleanupAllTimers(): void {
		for (const timeout of this.activeTimeouts) {
			clearTimeout(timeout);
		}
		this.activeTimeouts.clear();

		for (const interval of this.activeIntervals) {
			clearInterval(interval);
		}
		this.activeIntervals.clear();

		if (this.memoryMonitor) {
			clearInterval(this.memoryMonitor);
			this.memoryMonitor = null;
		}
	}

	@bindThis
	private cleanupProcessListeners(): void {
		for (const [event, handler] of this.processListeners) {
			process.off(event as any, handler);
		}
		this.processListeners.clear();
	}

	@bindThis
	private createManagedTimeout(callback: () => void, delay: number): NodeJS.Timeout {
		const timeout = setTimeout(() => {
			callback();
			this.activeTimeouts.delete(timeout);
		}, delay);
		this.activeTimeouts.add(timeout);
		return timeout;
	}

	@bindThis
	private createManagedInterval(callback: () => void, delay: number): NodeJS.Timeout {
		const interval = setInterval(callback, delay);
		this.activeIntervals.add(interval);
		return interval;
	}

	@bindThis
	private validateOfflineGeocodingConfig(): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];
		const config = this.config.offlineGeocoding as any;

		if (!config || typeof config !== 'object') {
			errors.push('offlineGeocoding configuration is not an object');
			return { isValid: false, errors };
		}

		const requiredBooleanFields = ['downloadFullGeoNames', 'includeAlternateNames', 'downloadOSM'];

		for (const field of requiredBooleanFields) {
			if (config[field] === undefined || config[field] === null) {
				errors.push(`Missing required field: ${field}`);
			} else if (typeof config[field] !== 'boolean') {
				errors.push(`Field '${field}' must be a boolean (true/false), got: ${typeof config[field]}`);
			}
		}

		if (config.downloadFullGeoNames === false && config.downloadOSM === false) {
			errors.push('At least one data source must be enabled (downloadFullGeoNames or downloadOSM)');
		}

		if (config.downloadFullGeoNames === true && config.includeAlternateNames === undefined) {
			this.logger.warn('downloadFullGeoNames is enabled but includeAlternateNames is not specified. Defaulting to true.');
		}

		return { isValid: errors.length === 0, errors };
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
			// Use for loop instead of spread to avoid call stack issues
			for (const entry of fullGeoNamesData) {
				results.push(entry);
			}
			this.logger.info(`Full GeoNames data: ${fullGeoNamesData.length} entries`);
		} else {
			const cityData = await this.downloadAndProcessGeoNamesCities();
			// Use for loop instead of spread to avoid call stack issues
			for (const entry of cityData) {
				results.push(entry);
			}
			this.logger.info(`City data: ${cityData.length} entries`);
		}

		if (this.config.offlineGeocoding?.downloadOSM) {
			const osmData = await this.downloadAndProcessOSMPBF();
			// Use for loop instead of spread to avoid call stack issues
			for (const entry of osmData) {
				results.push(entry);
			}
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
			this.logger.info('Downloading allCountries.zip...');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.allCountries, allCountriesPath, false, true, true);

			const alternateNamesPath = path.join(this.syncDataPath, 'alternateNames.zip');
			this.logger.info('Downloading alternateNames.zip (multilingual names)...');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.alternateNames, alternateNamesPath, false, true, true);

			const admin1Path = path.join(this.syncDataPath, 'admin1Codes.txt');
			await this.downloadService.downloadUrl(this.OSM_DATA_SOURCES.admin1Codes, admin1Path, false, true);

			const mainData = await this.processLargeGeoNamesFile(allCountriesPath);
			// Use for loop instead of spread to avoid call stack issues
			for (const entry of mainData) {
				results.push(entry);
			}
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
				await this.downloadService.downloadUrl(dataset.url, zipPath, false, true, true);

				const geoData = await this.processGeoNamesZip(zipPath, dataset.minPopulation);
				// Use for loop instead of spread to avoid call stack issues
				for (const entry of geoData) {
					results.push(entry);
				}

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
			const tempDir = path.join(this.syncDataPath, 'temp_extract_' + Date.now());
			await fs.mkdir(tempDir, { recursive: true });

			try {
				const zipBuffer = await fs.readFile(zipPath);
				ZipReader.withDestinationPath(tempDir).viaBuffer(zipBuffer);

				const files = await fs.readdir(tempDir);
				if (files.length === 0) {
					throw new Error('No files extracted from ZIP');
				}

				const txtFile = files.find(file => file.endsWith('.txt'));
				if (!txtFile) {
					throw new Error('No .txt file found in ZIP');
				}

				const csvContent = await fs.readFile(path.join(tempDir, txtFile), 'utf-8');
				const lines = csvContent.split('\n');

				const batchSize = 1000;
				const batch: GeoDataEntry[] = [];

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (!line.trim()) continue;

					const parts = line.split('\t');
					if (parts.length < 19) continue;

					try {
						const geoEntry = this.parseGeoNamesLine(parts, minPopulation);
						if (geoEntry) {
							batch.push(geoEntry);
						}
					} catch (parseError) {
					}

					if (batch.length >= batchSize || i % 1000 === 0) {
						if (batch.length > 0) {
							for (const item of batch) {
								results.push(item);
							}
							batch.length = 0;
						}
						await new Promise(resolve => setImmediate(resolve));
					}
				}

				if (batch.length > 0) {
					for (const item of batch) {
						results.push(item);
					}
				}
			} finally {
				try {
					await fs.rm(tempDir, { recursive: true, force: true });
				} catch (cleanupError) {
					this.logger.warn('Failed to cleanup temp directory:', (cleanupError as Error));
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

				stream.on('data', async (chunk: string | Buffer) => {
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
							if (memUsage.heapUsed > this.maxMemoryUsage) {
								memoryWarningCount++;
								this.logger.warn(`High memory usage detected: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);

								if (global.gc) {
									global.gc();
								}
							}
						}
					}

					if (chunkData.length >= CHUNK_SIZE) {
						const validEntries = await this.filterAndValidateData(chunkData);
						for (const entry of validEntries) {
							results.push(entry);
						}
						chunkData = [];

						if (results.length > 500000) {
							this.logger.warn(`Results array too large (${results.length}), clearing to prevent memory overflow`);
							results.length = Math.min(results.length, 100000);
							if (global.gc) {
								global.gc();
							}
						}

						const progress = Math.round((processedSize / totalSize) * 100);
						this.logger.info(`Processing progress: ${progress}% (${lineCount} lines, ${validEntryCount} valid entries, ${results.length} in memory)`);

						setTimeout(() => {
							stream.resume();
						}, 50);
						return;
					}

					setImmediate(() => stream.resume());
				});

				stream.on('end', async () => {
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
							const validEntries = await this.filterAndValidateData(chunkData);
							for (const entry of validEntries) {
								results.push(entry);
							}
						}

						this.logger.info(`File processing completed:`);
						this.logger.info(`- Total lines processed: ${lineCount}`);
						this.logger.info(`- Valid entries: ${this.dataQualityStats.validEntries}`);
						this.logger.info(`- Invalid coordinates: ${this.dataQualityStats.invalidCoordinates}`);
						this.logger.info(`- Duplicates removed: ${this.dataQualityStats.duplicates}`);
						this.logger.info(`- Suspicious data filtered: ${this.dataQualityStats.suspiciousData}`);
						this.logger.info(`- Memory warnings: ${memoryWarningCount}`);
						this.logger.info(`- Final result count: ${results.length}`);

						// stream.destroy(); // Do not explicitly destroy, let it close naturally
						// stream.once('close', () => {
						// 	resolve(results);
						// });
						resolve(results);
					} catch (endError) {
						this.logger.error('Error during stream end processing:', (endError as Error));
						stream.destroy();
						stream.once('close', () => {
							reject(endError);
						});
					}
				});

				stream.on('error', (err) => {
					stream.destroy();
					reject(err);
				});
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

			const tempDir = path.join(this.syncDataPath, 'temp_extract_alt_' + Date.now());
			await fs.mkdir(tempDir, { recursive: true });

			try {
				const zipBuffer = await fs.readFile(zipPath);
				ZipReader.withDestinationPath(tempDir).viaBuffer(zipBuffer);

				const files = await fs.readdir(tempDir);
				if (files.length === 0) {
					throw new Error('No files extracted from ZIP');
				}

				const txtFile = files.find(file => file.endsWith('.txt'));
				if (!txtFile) {
					throw new Error('No .txt file found in ZIP');
				}

				const filePath = path.join(tempDir, txtFile);
				const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });

				let processedCount = 0;
				let buffer = '';
				let lineNumber = 0;

				const processChunk = (chunk: string) => {
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						lineNumber++;
						if (!line.trim()) continue;

						try {
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
						} catch (parseError) {
							if (lineNumber % 100000 === 0) {
								this.logger.warn(`Parse error at line ${lineNumber}:`, parseError as Error);
							}
						}

						if (processedCount % 50000 === 0 && processedCount > 0) {
							this.logger.info(`Multilingual names processing progress: ${processedCount} entries`);
						}
					}
				};

				await new Promise<void>((resolve, reject) => {
					stream.on('data', (chunk: string | Buffer) => {
						try {
							const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
							processChunk(chunkStr);
						} catch (error) {
							this.logger.error('Error processing chunk:', error as Error);
						}
					});

					stream.on('end', () => {
						try {
							if (buffer.trim()) {
								try {
									const parts = buffer.split('\t');
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
								} catch (parseError) {
									this.logger.warn('Error processing final buffer:', parseError as Error);
								}
							}
							stream.destroy();
							stream.once('close', () => {
								resolve();
							});
						} catch (endError) {
							this.logger.error('Error during stream end processing:', endError as Error);
							stream.destroy();
							stream.once('close', () => {
								reject(endError);
							});
						}
					});

					stream.on('error', (err) => {
						stream.destroy();
						reject(err);
					});
				});

				this.logger.info(`Multilingual names processing completed: ${processedCount} entries`);
			} finally {
				try {
					await fs.rm(tempDir, { recursive: true, force: true });
				} catch (cleanupError) {
					this.logger.warn('Failed to cleanup temp directory:', (cleanupError as Error));
				}
			}
		} catch (error) {
			this.logger.warn('Failed to process multilingual names:', error as any);
		}
	}

	@bindThis
	private async downloadAndProcessOSMPBF(): Promise<GeoDataEntry[]> {
		this.logger.warn('Processing OSM PBF data requires a large amount of memory and time (several GB of data). Recommended to enable only when necessary.');

		const results: GeoDataEntry[] = [];

		try {
			if (this.config.offlineGeocoding?.downloadOSM) {
				this.logger.warn('Starting OSM data download for global dataset...');
				this.logger.warn('WARNING: This will download the entire planet OSM data. This may take several hours and requires significant disk space and memory.');

				const planetOsmPath = path.join(this.syncDataPath, 'planet-latest.osm.pbf');

				try {
					await this.downloadService.downloadUrl(
						this.OSM_DATA_SOURCES.planet,
						planetOsmPath,
						false,
						true,
						true
					);

					this.logger.info('OSM PBF file downloaded, processing...');

					const osmEntries = await this.parseOSMPBF(planetOsmPath);
					if (results.length + osmEntries.length <= 200000) {
						for (const entry of osmEntries) {
							results.push(entry);
						}
					} else {
						const sampleSize = Math.max(0, 200000 - results.length);
						for (let i = 0; i < sampleSize && i < osmEntries.length; i++) {
							results.push(osmEntries[i]);
						}
						this.logger.info(`Added ${sampleSize} OSM entries to results, ${osmEntries.length - sampleSize} added to spatial index only`);
					}

					this.logger.info(`OSM processing completed: ${osmEntries.length} entries`);
				} catch (downloadError) {
					this.logger.warn('OSM data download failed, skipping OSM processing:', downloadError as any);
				}
			}
		} catch (error) {
			this.logger.error('OSM processing failed:', error as any);
		}

		return results;
	}

	@bindThis
	private async parseOSMPBF(filePath: string): Promise<GeoDataEntry[]> {
		this.logger.info('Starting OSM PBF parsing with streaming memory optimization...');

		const BATCH_SIZE = 1000;
		let batch: GeoDataEntry[] = [];
		let indexedCount = 0;

		try {
			const stats = await stat(filePath);
			if (stats.size === 0) {
				this.logger.warn('OSM PBF file is empty');
				return [];
			}

			this.logger.info(`Processing OSM PBF file: ${Math.round(stats.size / 1024 / 1024)}MB`);

			let processedCount = 0;
			let nodeCount = 0;
			let wayCount = 0;
			let relationCount = 0;

			for await (const item of createOSMStream(filePath, { withTags: true, withInfo: false }) as AsyncIterable<OSMItem>) {
				try {
					let geoEntry: GeoDataEntry | null = null;

					if (item.type === 'node') {
						nodeCount++;
						if (item.tags && this.isRelevantOSMNode(item.tags)) {
							geoEntry = this.convertOSMNodeToGeoEntry(item);
						}
					} else if (item.type === 'way') {
						wayCount++;
						if (item.tags && this.isRelevantOSMWay(item.tags)) {
							geoEntry = this.convertOSMWayToGeoEntry(item);
						}
					} else if (item.type === 'relation') {
						relationCount++;
						if (item.tags && this.isRelevantOSMRelation(item.tags)) {
							geoEntry = this.convertOSMRelationToGeoEntry(item);
						}
					}

					if (geoEntry) {
						batch.push(geoEntry);
						processedCount++;

						if (batch.length >= BATCH_SIZE) {
							for (const entry of batch) {
								this.addToSpatialIndex(entry);
							}

							batch = [];

							if (global.gc && processedCount % 25000 === 0) {
								global.gc();
							}
						}
					}

					if ((nodeCount + wayCount + relationCount) % 50000 === 0) {
						this.logger.info(`Processed: ${nodeCount} nodes, ${wayCount} ways, ${relationCount} relations. Found ${processedCount} relevant entries.`);

						const memUsage = process.memoryUsage();
						const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
						if (memUsage.heapUsed > 2000000000) {
							this.logger.error(`High memory usage detected: ${heapUsedMB}MB - forcing immediate garbage collection`);
							if (global.gc) {
								global.gc();
								global.gc();
							}
							const memAfterGC = process.memoryUsage();
							if (memAfterGC.heapUsed > 2500000000) {
								this.logger.error(`Memory still too high after GC (${Math.round(memAfterGC.heapUsed / 1024 / 1024)}MB), stopping processing to prevent crash`);
								break;
							}
						}
					}
				} catch (err) {
					this.logger.warn('Error processing OSM item:', err as Error);
				}
			}

			if (batch.length > 0) {
				for (const entry of batch) {
					this.addToSpatialIndex(entry);
				}
				indexedCount += batch.length;
			}

			this.logger.info(`OSM PBF parsing completed: ${processedCount} relevant entries processed from ${nodeCount} nodes, ${wayCount} ways, ${relationCount} relations`);
			this.logger.info(`Indexed ${indexedCount} entries directly to spatial index`);
		} catch (error) {
			this.logger.error('OSM PBF parsing failed:', error as any);
		}

		return [];
	}

	@bindThis
	private async parsePBFBuffer(buffer: Buffer): Promise<any[]> {
		const results: any[] = [];
		let offset = 0;

		this.logger.info('Parsing PBF buffer with custom implementation...');

		while (offset < buffer.length) {
			try {
				if (offset + 4 > buffer.length) break;

				const headerLength = buffer.readUInt32BE(offset);
				offset += 4;

				if (offset + headerLength > buffer.length) break;

				const headerData = buffer.subarray(offset, offset + headerLength);
				offset += headerLength;

				const header = this.parseSimplePBFMessage(headerData);

				if (!header.datasize) continue;

				const blobSize = header.datasize;
				if (offset + blobSize > buffer.length) break;

				const blobData = buffer.subarray(offset, offset + blobSize);
				offset += blobSize;

				const blob = this.parseSimplePBFMessage(blobData);

				let primitiveBlockData: Buffer;

				if (blob.raw) {
					primitiveBlockData = blob.raw;
				} else if (blob.zlib_data) {
					const zlib = await import('node:zlib');
					primitiveBlockData = zlib.inflateSync(blob.zlib_data);
				} else {
					continue;
				}

				const primitiveBlock = this.parseSimplePBFMessage(primitiveBlockData);

				if (primitiveBlock.primitivegroup) {
					const groups = Array.isArray(primitiveBlock.primitivegroup)
						? primitiveBlock.primitivegroup
						: [primitiveBlock.primitivegroup];

					for (const group of groups) {
						if (group.nodes) {
							const nodes = Array.isArray(group.nodes) ? group.nodes : [group.nodes];
							for (const node of nodes) {
								if (node.id && node.lat !== undefined && node.lon !== undefined) {
									const lat = node.lat / 10000000;
									const lon = node.lon / 10000000;

									const tags: Record<string, string> = {};
									if (node.keys && node.vals && primitiveBlock.stringtable) {
										const strings = primitiveBlock.stringtable.s || [];
										for (let i = 0; i < node.keys.length && i < node.vals.length; i++) {
											const keyIndex = node.keys[i];
											const valIndex = node.vals[i];
											if (strings[keyIndex] && strings[valIndex]) {
												const key = strings[keyIndex].toString('utf8');
												tags[key] = strings[valIndex].toString('utf8');
											}
										}
									}

									results.push({
										type: 'node',
										id: node.id,
										lat,
										lon,
										tags
									});
								}
							}
						}
					}
				}

				if (results.length % 50000 === 0) {
					await new Promise(resolve => setImmediate(resolve));
				}
			} catch (parseError) {
				this.logger.warn(`PBF parsing error at offset ${offset}:`, parseError as Error);
				offset += Math.min(1024, buffer.length - offset);
			}
		}

		return results;
	}

	@bindThis
	private parseSimplePBFMessage(buffer: Buffer): any {
		const result: any = {};
		let offset = 0;

		while (offset < buffer.length) {
			const { value: fieldHeader, length: headerLen } = this.readVarint(buffer, offset);
			offset += headerLen;

			const fieldNumber = fieldHeader >> 3;
			const wireType = fieldHeader & 0x7;

			if (wireType === 0) {
				const { value, length } = this.readVarint(buffer, offset);
				offset += length;
				this.setField(result, fieldNumber, value);
			} else if (wireType === 2) {
				const { value: length, length: lenLen } = this.readVarint(buffer, offset);
				offset += lenLen;

				if (offset + length > buffer.length) break;

				const data = buffer.subarray(offset, offset + length);
				offset += length;

				if (fieldNumber === 2 && result.type === 'primitivegroup') { // primitivegroup.nodes
					if (!result.nodes) result.nodes = [];
					result.nodes.push(this.parseSimplePBFMessage(data));
				} else if (fieldNumber === 1 || fieldNumber === 2) { // stringtable.s
					if (!result.stringtable) result.stringtable = {};
					if (!result.stringtable.s) result.stringtable.s = [];
					result.stringtable.s.push(data);
				} else {
					this.setField(result, fieldNumber, data);
				}
			} else {
				break;
			}
		}

		return result;
	}

	@bindThis
	private readVarint(buffer: Buffer, offset: number): { value: number, length: number } {
		let value = 0;
		let length = 0;
		let shift = 0;

		while (offset + length < buffer.length) {
			const byte = buffer[offset + length];
			length++;

			value |= (byte & 0x7F) << shift;
			shift += 7;

			if ((byte & 0x80) === 0) {
				break;
			}

			if (length > 10) {
				throw new Error('Varint too long');
			}
		}

		return { value, length };
	}

	@bindThis
	private setField(obj: any, fieldNumber: number, value: any): void {
		const fieldMap: Record<number, string> = {
			1: 'type',
			2: 'primitivegroup',
			3: 'datasize',
			4: 'raw',
			5: 'zlib_data',
			8: 'nodes',
			10: 'id',
			11: 'keys',
			12: 'vals',
			13: 'lat',
			14: 'lon'
		};

		const fieldName = fieldMap[fieldNumber] || `field_${fieldNumber}`;

		if (obj[fieldName] !== undefined) {
			if (!Array.isArray(obj[fieldName])) {
				obj[fieldName] = [obj[fieldName]];
			}
			obj[fieldName].push(value);
		} else {
			obj[fieldName] = value;
		}
	}

	@bindThis
	private isRelevantOSMNode(tags: Record<string, string>): boolean {
		const relevantKeys = [
			'place', 'name', 'amenity', 'shop', 'tourism', 'leisure',
			'office', 'craft', 'emergency', 'healthcare', 'historic',
			'landuse', 'natural', 'railway', 'highway', 'addr:city',
			'addr:town', 'addr:village', 'population'
		];

		return relevantKeys.some(key => tags[key] !== undefined) ||
			   (tags.name !== undefined && Object.keys(tags).length > 1);
	}

	@bindThis
	private convertOSMNodeToGeoEntry(osmNode: any): GeoDataEntry | null {
		if (!osmNode.tags || !osmNode.lat || !osmNode.lon) return null;

		const tags = osmNode.tags;
		const level = this.determineOSMLevel(tags);
		const importance = this.calculateOSMImportance(tags);

		let population: number | undefined;
		if (tags.population) {
			const pop = parseInt(tags.population);
			if (!isNaN(pop)) population = pop;
		}

		return {
			lat: osmNode.lat,
			lon: osmNode.lon,
			properties: {
				name: tags.name || tags['name:en'] || tags['name:zh'] || '',
				display_name: this.formatOSMDisplayName(tags),
				city: tags['addr:city'] || tags['is_in:city'],
				town: tags['addr:town'],
				village: tags['addr:village'],
				county: tags['addr:county'],
				state: tags['addr:state'] || tags['is_in:state'],
				country: tags['addr:country'] || tags['is_in:country'],
				country_code: tags['addr:country_code'] || tags['ISO3166-1'],
				postcode: tags['addr:postcode'],
				road: tags['addr:street'],
				house_number: tags['addr:housenumber'],
				district: tags['addr:district'],
				suburb: tags['addr:suburb'],
				neighbourhood: tags['addr:neighbourhood'],
				...tags
			},
			level,
			population,
			importance,
			place_id: parseInt(osmNode.id.toString()),
			osm_id: parseInt(osmNode.id.toString()),
			hash: this.generateDataHash(`osm_${osmNode.id}`)
		};
	}

	@bindThis
	private formatOSMDisplayName(tags: Record<string, string>): string {
		const parts: string[] = [];

		if (tags.name) parts.push(tags.name);
		if (tags.amenity && tags.amenity !== tags.name) parts.push(tags.amenity);
		if (tags['addr:street']) parts.push(tags['addr:street']);
		if (tags['addr:city'] && tags['addr:city'] !== tags.name) parts.push(tags['addr:city']);
		if (tags['addr:state']) parts.push(tags['addr:state']);
		if (tags['addr:country']) parts.push(tags['addr:country']);

		return parts.length > 0 ? parts.join(', ') : `OSM Node ${tags.id || 'Unknown'}`;
	}

	@bindThis
	private isRelevantOSMWay(tags: Record<string, string>): boolean {
		const relevantKeys = [
			'highway', 'building', 'name', 'place', 'landuse', 'natural',
			'amenity', 'shop', 'leisure', 'tourism', 'historic', 'addr:city',
			'addr:town', 'addr:street', 'railway', 'waterway', 'man_made'
		];

		return relevantKeys.some(key => tags[key] !== undefined) ||
			   (tags.name !== undefined && Object.keys(tags).length > 2);
	}

	@bindThis
	private convertOSMWayToGeoEntry(osmWay: any): GeoDataEntry | null {
		if (!osmWay.tags || !osmWay.lat || !osmWay.lon) return null;

		const tags = osmWay.tags;
		const level = this.determineOSMWayLevel(tags);
		const importance = this.calculateOSMImportance(tags);

		return {
			lat: osmWay.lat,
			lon: osmWay.lon,
			properties: {
				name: tags.name || tags['name:en'] || tags['name:zh'] || '',
				display_name: this.formatOSMWayDisplayName(tags),
				highway: tags.highway,
				building: tags.building,
				landuse: tags.landuse,
				natural: tags.natural,
				city: tags['addr:city'] || tags['is_in:city'],
				town: tags['addr:town'],
				street: tags['addr:street'] || tags.name,
				country: tags['addr:country'] || tags['is_in:country'],
				...tags
			},
			level,
			importance,
			place_id: parseInt(osmWay.id.toString()),
			osm_id: parseInt(osmWay.id.toString()),
			hash: this.generateDataHash(`osm_way_${osmWay.id}`)
		};
	}

	@bindThis
	private determineOSMWayLevel(tags: Record<string, string>): GeoDataEntry['level'] {
		if (tags.place) {
			switch (tags.place) {
				case 'city': return 'city';
				case 'town': return 'town';
				case 'village': return 'village';
				case 'county': return 'county';
				default: return 'district';
			}
		}

		if (tags.highway) {
			if (['motorway', 'trunk', 'primary'].includes(tags.highway)) return 'district';
			return 'village';
		}

		if (tags.building && tags.name) return 'village';
		if (tags.landuse && tags.name) return 'district';

		return 'district';
	}

	@bindThis
	private formatOSMWayDisplayName(tags: Record<string, string>): string {
		const parts: string[] = [];

		if (tags.name) parts.push(tags.name);
		if (tags.highway && tags.highway !== tags.name) parts.push(`Highway ${tags.highway}`);
		if (tags.building && tags.building !== 'yes' && tags.building !== tags.name) parts.push(tags.building);
		if (tags['addr:street']) parts.push(tags['addr:street']);
		if (tags['addr:city'] && tags['addr:city'] !== tags.name) parts.push(tags['addr:city']);
		if (tags['addr:country']) parts.push(tags['addr:country']);

		return parts.length > 0 ? parts.join(', ') : `OSM Way ${tags.id || 'Unknown'}`;
	}

	@bindThis
	private isRelevantOSMRelation(tags: Record<string, string>): boolean {
		const relevantKeys = [
			'type', 'name', 'place', 'admin_level', 'boundary',
			'landuse', 'natural', 'amenity', 'leisure', 'tourism',
			'multipolygon', 'route', 'public_transport'
		];

		const isAdministrativeRelation = tags.type === 'boundary' && tags.boundary === 'administrative';
		const isMultipolygon = tags.type === 'multipolygon';
		const hasRelevantTags = relevantKeys.some(key => tags[key] !== undefined);
		const hasName = tags.name !== undefined;

		return (isAdministrativeRelation || isMultipolygon || hasRelevantTags) && hasName;
	}

	@bindThis
	private convertOSMRelationToGeoEntry(osmRelation: any): GeoDataEntry | null {
		if (!osmRelation.tags || !osmRelation.lat || !osmRelation.lon) return null;

		const tags = osmRelation.tags;
		const level = this.determineOSMRelationLevel(tags);
		const importance = this.calculateOSMRelationImportance(tags);

		let population: number | undefined;
		if (tags.population) {
			const pop = parseInt(tags.population);
			if (!isNaN(pop)) population = pop;
		}

		return {
			lat: osmRelation.lat,
			lon: osmRelation.lon,
			properties: {
				name: tags.name || tags['name:en'] || tags['name:zh'] || '',
				display_name: this.formatOSMRelationDisplayName(tags),
				type: tags.type,
				boundary: tags.boundary,
				admin_level: tags.admin_level,
				place: tags.place,
				city: tags['addr:city'] || tags['is_in:city'],
				state: tags['addr:state'] || tags['is_in:state'],
				country: tags['addr:country'] || tags['is_in:country'],
				...tags
			},
			level,
			population,
			importance,
			place_id: parseInt(osmRelation.id.toString()),
			osm_id: parseInt(osmRelation.id.toString()),
			hash: this.generateDataHash(`osm_relation_${osmRelation.id}`)
		};
	}

	@bindThis
	private determineOSMRelationLevel(tags: Record<string, string>): GeoDataEntry['level'] {
		if (tags.type === 'boundary' && tags.boundary === 'administrative') {
			const adminLevel = parseInt(tags.admin_level);
			if (!isNaN(adminLevel)) {
				if (adminLevel <= 2) return 'country';
				if (adminLevel <= 4) return 'state';
				if (adminLevel <= 6) return 'county';
				if (adminLevel <= 8) return 'city';
				if (adminLevel <= 10) return 'district';
			}
		}

		if (tags.place) {
			switch (tags.place) {
				case 'country': return 'country';
				case 'state': case 'province': return 'state';
				case 'city': return 'city';
				case 'town': return 'town';
				case 'village': return 'village';
				case 'county': return 'county';
				default: return 'district';
			}
		}

		return 'district';
	}

	@bindThis
	private calculateOSMRelationImportance(tags: Record<string, string>): number {
		let importance = 0;

		if (tags.type === 'boundary' && tags.boundary === 'administrative') {
			const adminLevel = parseInt(tags.admin_level);
			if (!isNaN(adminLevel)) {
				importance += Math.max(0, 1 - (adminLevel / 12));
			}
		}

		if (tags.name) importance += 0.3;
		if (tags.place) importance += 0.4;
		if (tags.population) {
			const population = parseInt(tags.population);
			if (!isNaN(population)) {
				importance += Math.log10(population) / 10;
			}
		}

		return Math.min(importance, 1);
	}

	@bindThis
	private formatOSMRelationDisplayName(tags: Record<string, string>): string {
		const parts: string[] = [];

		if (tags.name) parts.push(tags.name);
		if (tags.type && tags.type !== 'multipolygon') parts.push(`(${tags.type})`);
		if (tags.admin_level) parts.push(`Admin Level ${tags.admin_level}`);
		if (tags.place && tags.place !== tags.name) parts.push(tags.place);
		if (tags['addr:country']) parts.push(tags['addr:country']);

		return parts.length > 0 ? parts.join(', ') : `OSM Relation ${tags.id || 'Unknown'}`;
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
	private async saveOptimizedDataAsJSON(data: GeoDataEntry[]): Promise<void> {
		this.logger.info('Saving optimized data as JSON for quick loading...');

		try {
			const dataFilePath = path.join(this.dataPath, 'cities_optimized.json');
			await fs.writeFile(dataFilePath, JSON.stringify(data), 'utf-8');

			const spatialIndexArray = Array.from(this.spatialIndex.entries());
			const indexFilePath = path.join(this.dataPath, 'spatial_index.json');
			await fs.writeFile(indexFilePath, JSON.stringify(spatialIndexArray), 'utf-8');

			this.logger.info(`JSON format save completed: ${data.length} entries`);
		} catch (error) {
			this.logger.error('JSON format save failed:', error as any);
		}
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

		const compressed = await new Promise<Buffer>((resolve, reject) => {
			import('node:zlib').then(zlib => {
				const gzip = zlib.createGzip();
				const chunks: Buffer[] = [];

				gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
				gzip.on('end', () => resolve(Buffer.concat(chunks)));
				gzip.on('error', reject);

				gzip.end(buffer.subarray(0, offset));
			}).catch(reject);
		});
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
		const result = await this.executeWithMemoryCheck('process', async () => {
			const indexPath = path.join(this.dataPath, 'geodata.index');

			try {
				await fs.access(indexPath);
			} catch (error) {
				this.logger.info('Binary index file not found, skipping binary load');
				return false;
			}

			const indexContent = await fs.readFile(indexPath, 'utf-8');
			let indexData: any;

			try {
				indexData = JSON.parse(indexContent);
			} catch (parseError) {
				this.logger.error('Corrupted binary index file:', parseError as Error);
				await this.cleanupCorruptedBinaryFiles();
				return false;
			}

			if (indexData.version !== this.BINARY_FORMAT_VERSION) {
				this.logger.warn('Binary format version mismatch, regenerating data');
				return false;
			}

			if (!indexData.shardCount || indexData.shardCount <= 0) {
				this.logger.warn('Invalid shard count in index file');
				return false;
			}

			this.logger.info(`Loading binary format data: ${indexData.shardCount} shards`);

			const allData: GeoDataEntry[] = [];
			const failedShards: number[] = [];

			for (let i = 0; i < indexData.shardCount; i++) {
				try {
					const shardPath = path.join(this.dataPath, `geodata_shard_${i}.bin`);
					const shardData = await this.readBinaryShardSafely(shardPath, i);
					allData.push(...shardData);

					if (i % 10 === 0) {
						this.logger.info(`Loading progress: ${i + 1}/${indexData.shardCount} shards`);
					}
				} catch (shardError) {
					this.logger.error(`Failed to load shard ${i}:`, shardError as Error);
					failedShards.push(i);
				}
			}

			if (failedShards.length > 0) {
				this.logger.warn(`Failed to load ${failedShards.length} shards: ${failedShards.join(', ')}`);
				if (failedShards.length >= indexData.shardCount * 0.5) {
					this.logger.error('More than 50% of shards failed to load, binary data is corrupted');
					return false;
				}
			}

			if (allData.length === 0) {
				this.logger.warn('No valid data loaded from binary format');
				return false;
			}

			this.geoData = allData;
			this.buildSpatialIndex();

			this.logger.info(`Binary data loaded: ${allData.length} entries (${failedShards.length} shards failed)`);
			return true;
		}, { timeout: 300000, cancellable: false });

		if (!result.success) {
			this.logger.error('Binary format loading failed:', result.error);
			return false;
		}

		return result.data || false;
	}

	@bindThis
	private async readBinaryShardSafely(filePath: string, shardIndex: number): Promise<GeoDataEntry[]> {
		try {
			const stats = await fs.stat(filePath);
			if (stats.size === 0) {
				throw new Error(`Empty shard file: ${filePath}`);
			}

			return await this.readBinaryShard(filePath);
		} catch (error) {
			this.logger.error(`Error reading shard ${shardIndex} from ${filePath}:`, error as Error);
			throw new Error(`Shard ${shardIndex} read failed: ${(error as Error).message}`);
		}
	}

	@bindThis
	private async readBinaryShard(filePath: string): Promise<GeoDataEntry[]> {
		let compressedData: Buffer;
		try {
			compressedData = await fs.readFile(filePath);
		} catch (readError) {
			throw new Error(`Failed to read shard file: ${(readError as Error).message}`);
		}

		let buffer: Buffer;
		try {
			buffer = await new Promise<Buffer>((resolve, reject) => {
				import('node:zlib').then(zlib => {
					const gunzip = zlib.createGunzip();
					const chunks: Buffer[] = [];

					gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
					gunzip.on('end', () => resolve(Buffer.concat(chunks)));
					gunzip.on('error', reject);

					gunzip.end(compressedData);
				}).catch(reject);
			});
		} catch (decompressError) {
			throw new Error(`Failed to decompress shard: ${(decompressError as Error).message}`);
		}

		if (buffer.length < 8) {
			throw new Error('Invalid shard file: too small');
		}

		const results: GeoDataEntry[] = [];
		let offset = 0;

		try {
			const version = buffer.readUInt32LE(offset);
			offset += 4;
			const recordCount = buffer.readUInt32LE(offset);
			offset += 4;

			if (version !== this.BINARY_FORMAT_VERSION) {
				throw new Error(`Shard version mismatch: expected ${this.BINARY_FORMAT_VERSION}, got ${version}`);
			}

			if (recordCount < 0 || recordCount > 10000000) {
				throw new Error(`Invalid record count: ${recordCount}`);
			}

			for (let i = 0; i < recordCount; i++) {
				try {
					if (offset + 33 > buffer.length) {
						throw new Error(`Unexpected end of buffer at record ${i}`);
					}

					const lat = buffer.readDoubleLE(offset);
					offset += 8;
					const lon = buffer.readDoubleLE(offset);
					offset += 8;

					if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
						this.logger.warn(`Invalid coordinates in record ${i}: lat=${lat}, lon=${lon}`);
						continue;
					}

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

					if (offset + nameLength > buffer.length) {
						throw new Error(`Name length exceeds buffer at record ${i}`);
					}
					offset += nameLength;

					const propsLength = buffer.readUInt16LE(offset);
					offset += 2;

					if (offset + propsLength > buffer.length) {
						throw new Error(`Properties length exceeds buffer at record ${i}`);
					}

					const propsJSON = buffer.subarray(offset, offset + propsLength).toString('utf-8');
					offset += propsLength;

					let properties: any;
					try {
						properties = JSON.parse(propsJSON);
					} catch (jsonError) {
						this.logger.warn(`Invalid JSON properties in record ${i}:`, jsonError as Error);
						properties = {};
					}

					results.push({
						lat, lon, place_id, osm_id, importance, level, properties,
						hash: this.generateDataHash(`${place_id}_${osm_id}`),
					});
				} catch (recordError) {
					this.logger.warn(`Error parsing record ${i}:`, recordError as Error);
				}
			}
		} catch (parseError) {
			throw new Error(`Buffer parsing failed: ${(parseError as Error).message}`);
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

			const decompressedData = await new Promise<Buffer>((resolve, reject) => {
				import('node:zlib').then(zlib => {
					const gunzip = zlib.createGunzip();
					const chunks: Buffer[] = [];

					gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
					gunzip.on('end', () => resolve(Buffer.concat(chunks)));
					gunzip.on('error', reject);

					gunzip.end(compressedData);
				}).catch(reject);
			});
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

	@bindThis
	private async cleanupCorruptedBinaryFiles(): Promise<void> {
		try {
			this.logger.info('Cleaning up corrupted binary files...');

			const indexPath = path.join(this.dataPath, 'geodata.index');
			try {
				await fs.unlink(indexPath);
				this.logger.info('Removed corrupted index file');
			} catch (error) {
			}

			const files = await fs.readdir(this.dataPath);
			const shardFiles = files.filter(file => file.startsWith('geodata_shard_') && file.endsWith('.bin'));

			for (const shardFile of shardFiles) {
				try {
					await fs.unlink(path.join(this.dataPath, shardFile));
					this.logger.debug(`Removed corrupted shard: ${shardFile}`);
				} catch (error) {
					this.logger.warn(`Failed to remove shard ${shardFile}:`, error as Error);
				}
			}

			this.logger.info(`Cleaned up ${shardFiles.length} corrupted binary files`);
		} catch (error) {
			this.logger.error('Error during binary file cleanup:', error as Error);
		}
	}

	@bindThis
	private async recoverFromDataCorruption(): Promise<boolean> {
		this.logger.warn('Attempting to recover from data corruption...');

		try {
			await this.cleanupCorruptedBinaryFiles();

			const dataFiles = [
				'cities_world.json',
				'administrative_divisions.json',
				'poi_data.json'
			];

			let recoveredData = false;
			for (const filename of dataFiles) {
				try {
					const filePath = path.join(this.dataPath, filename);
					const stats = await fs.stat(filePath);
					if (stats.size > 0) {
						recoveredData = true;
						this.logger.info(`Found fallback data file: ${filename}`);
						break;
					}
				} catch (error) {
				}
			}

			if (recoveredData) {
				this.logger.info('Attempting to reinitialize from JSON files...');
				await this.initialize();
				return true;
			}

			this.logger.warn('No fallback data available, scheduling fresh download...');
			this.startInitialDownload().catch(error => {
				this.logger.error('Recovery download failed:', error as Error);
			});

			return false;
		} catch (error) {
			this.logger.error('Data recovery failed:', error as Error);
			return false;
		}
	}

	@bindThis
	private async validateDataIntegrity(): Promise<{
		isValid: boolean;
		issues: string[];
		criticalIssues: string[];
	}> {
		const issues: string[] = [];
		const criticalIssues: string[] = [];

		try {
			if (this.geoData.length === 0) {
				criticalIssues.push('No geographic data loaded');
			}

			if (this.geoData.length > 0 && this.spatialIndex.size === 0) {
				criticalIssues.push('Spatial index not built despite having data');
			}

			const sampleSize = Math.min(1000, this.geoData.length);
			let invalidCoords = 0;
			let missingNames = 0;
			const duplicateIds = new Set();

			for (let i = 0; i < sampleSize; i++) {
				const entry = this.geoData[Math.floor(Math.random() * this.geoData.length)];

				if (isNaN(entry.lat) || isNaN(entry.lon) ||
					entry.lat < -90 || entry.lat > 90 ||
					entry.lon < -180 || entry.lon > 180) {
					invalidCoords++;
				}

				if (!entry.properties?.name && !entry.properties?.city) {
					missingNames++;
				}

				if (duplicateIds.has(entry.place_id)) {
					issues.push(`Duplicate place_id found: ${entry.place_id}`);
				} else {
					duplicateIds.add(entry.place_id);
				}
			}

			if (invalidCoords > sampleSize * 0.1) {
				criticalIssues.push(`High rate of invalid coordinates: ${Math.round(invalidCoords / sampleSize * 100)}%`);
			}

			if (missingNames > sampleSize * 0.5) {
				issues.push(`Many entries missing names: ${Math.round(missingNames / sampleSize * 100)}%`);
			}

			const memUsage = process.memoryUsage();
			if (memUsage.heapUsed > this.maxMemoryUsage * 0.9) {
				issues.push('Memory usage is very high');
			}

			return {
				isValid: criticalIssues.length === 0,
				issues,
				criticalIssues
			};
		} catch (error) {
			criticalIssues.push(`Integrity check failed: ${(error as Error).message}`);
			return {
				isValid: false,
				issues,
				criticalIssues
			};
		}
	}

	@bindThis
	public async performEmergencyRestart(): Promise<void> {
		this.logger.error('Performing emergency restart of geocoding service...');

		try {
			this.syncInProgress = false;

			for (const [operationId, operation] of this.activeOperations) {
				try {
					if (operation.cancel) {
						operation.cancel();
					}
				} catch (error) {
					this.logger.warn(`Error cancelling operation ${operationId}:`, error as Error);
				}
			}
			this.activeOperations.clear();

			this.cache.clear();
			this.precomputedResults.clear();
			this.geoData = [];
			this.spatialIndex.clear();
			this.hierarchicalIndex.clear();
			this.isInitialized = false;

			this.forceGarbageCollection();

			const recovered = await this.recoverFromDataCorruption();
			if (recovered) {
				this.logger.info('Emergency restart completed successfully');
			} else {
				this.logger.warn('Emergency restart completed but data recovery is pending');
			}
		} catch (error) {
			this.logger.error('Emergency restart failed:', error as Error);
			throw error;
		}
	}

	@bindThis
	private calculateOptimalMemoryLimit(): number {
		try {
			const nodeMemory = process.memoryUsage();

			let totalSystemMemory = 0;
			try {
				totalSystemMemory = os.totalmem();
			} catch (osError) {
				this.logger.warn('OS totalmem not available, using conservative estimation');
			}

			let availableMemory: number;
			if (totalSystemMemory > 0) {
				const currentHeapUsed = nodeMemory.heapUsed;
				const currentRSS = nodeMemory.rss;

				availableMemory = Math.floor(totalSystemMemory * 0.6) - currentRSS;

				availableMemory = Math.max(availableMemory, currentHeapUsed * 2);
			} else {
				availableMemory = Math.floor(nodeMemory.rss * 1.5);
			}

			const calculatedLimit = Math.floor(availableMemory * this.MEMORY_USAGE_RATIO);

			const finalLimit = Math.max(
				this.MIN_MEMORY_LIMIT,
				Math.min(calculatedLimit, this.MAX_MEMORY_LIMIT)
			);

			this.logger.debug(`Memory calculation: system=${Math.round(totalSystemMemory / 1024 / 1024)}MB, available=${Math.round(availableMemory / 1024 / 1024)}MB, limit=${Math.round(finalLimit / 1024 / 1024)}MB`);

			return finalLimit;
		} catch (error) {
			this.logger.warn('Error calculating optimal memory limit, using conservative fallback:', error as Error);
			return this.MIN_MEMORY_LIMIT * 2;
		}
	}

	@bindThis
	private initializeResourceManagement(): void {
		this.initializeMemoryMonitoring();
		this.setupErrorHandling();
	}

	@bindThis
	private setupGracefulShutdownHandling(): void {
		for (const [signal, handler] of this.processListeners) {
			if (['SIGTERM', 'SIGINT', 'SIGUSR2'].includes(signal)) {
				process.off(signal as any, handler);
				this.processListeners.delete(signal);
			}
		}

		['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
			const handler = () => {
				if (!this.gracefulShutdown) {
					this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
					this.performShutdown().finally(() => {
						process.exit(0);
					});
				}
			};

			process.on(signal, handler);
			this.processListeners.set(signal, handler);
		});
	}

	@bindThis
	private updateMemoryPressure(): void {
		const memUsage = process.memoryUsage();
		const usageRatio = memUsage.heapUsed / this.maxMemoryUsage;

		if (usageRatio > this.MEMORY_CRITICAL_THRESHOLD) {
			this.currentMemoryPressure = 3;
		} else if (usageRatio > this.MEMORY_WARNING_THRESHOLD) {
			this.currentMemoryPressure = 2;
		} else if (usageRatio > 0.5) {
			this.currentMemoryPressure = 1;
		} else {
			this.currentMemoryPressure = 0;
		}
	}

	@bindThis
	private shouldThrottleOperations(): boolean {
		return this.currentMemoryPressure >= 2 || this.gracefulShutdown;
	}

	@bindThis
	private async enforceMemoryLimits(): Promise<void> {
		if (this.currentMemoryPressure >= 3) {
			this.cache.clear();
			this.precomputedResults.clear();

			if (global.gc) {
				global.gc();
				setTimeout(() => global.gc && global.gc(), 1000);
			}

			this.logger.error('Critical memory pressure - performed aggressive cleanup');
		} else if (this.currentMemoryPressure >= 2) {
			const cacheSize = this.cache.size;
			const targetSize = Math.floor(cacheSize * 0.5);

			const keysToRemove = Array.from(this.cache.keys()).slice(0, cacheSize - targetSize);
			keysToRemove.forEach(key => this.cache.delete(key));

			this.logger.warn(`High memory pressure - cleared ${keysToRemove.length} cache entries`);
		}
	}

	@bindThis
	private async cleanupOperationTimeouts(): Promise<void> {
		const now = Date.now();
		const staleOperations: string[] = [];

		for (const [operationId, operation] of this.activeOperations) {
			if (now - operation.startTime > 1800000) {
				staleOperations.push(operationId);
			}
		}

		for (const operationId of staleOperations) {
			const timeout = this.operationTimeouts.get(operationId);
			if (timeout) {
				clearTimeout(timeout);
				this.operationTimeouts.delete(operationId);
			}
			this.activeOperations.delete(operationId);
			this.logger.warn(`Cleaned up stale operation: ${operationId}`);
		}
	}

	@bindThis
	public async performSystemHealthCheck(): Promise<{
		healthy: boolean;
		memoryPressure: number;
		activeOperations: number;
		concurrencyLimits: Record<string, number>;
		systemMetrics: {
			memoryUsage: number;
			memoryLimit: number;
			cacheSize: number;
			dataEntries: number;
		};
		issues: string[];
	}> {
		this.updateMemoryPressure();
		await this.cleanupOperationTimeouts();

		const memUsage = process.memoryUsage();
		const issues: string[] = [];

		if (this.currentMemoryPressure >= 3) {
			issues.push('Critical memory pressure detected');
		} else if (this.currentMemoryPressure >= 2) {
			issues.push('High memory pressure detected');
		}

		if (this.activeOperations.size > this.MAX_CONCURRENT_OPERATIONS * 0.8) {
			issues.push('High number of active operations');
		}

		const concurrencyLimits = { maxConcurrent: this.MAX_CONCURRENT_OPERATIONS };

		return {
			healthy: issues.length === 0 && this.currentMemoryPressure < 3,
			memoryPressure: this.currentMemoryPressure,
			activeOperations: this.activeOperations.size,
			concurrencyLimits,
			systemMetrics: {
				memoryUsage: memUsage.heapUsed,
				memoryLimit: this.maxMemoryUsage,
				cacheSize: this.cache.size,
				dataEntries: this.geoData.length
			},
			issues
		};
	}

	@bindThis
	private async checkAndDownloadMissingData(): Promise<void> {
		this.logger.info('Checking for missing data sources...');

		const config = this.config.offlineGeocoding;
		if (!config) return;

		const missingData: string[] = [];

		if (config.downloadOSM) {
			const osmDataExists = await this.checkOSMDataExists();
			if (!osmDataExists) {
				missingData.push('OSM data');
			}
		}

		if (config.downloadFullGeoNames) {
			const hasFullGeoNames = await this.checkFullGeoNamesDataExists();
			if (!hasFullGeoNames) {
				missingData.push('Full GeoNames data');
			}
		}

		if (missingData.length > 0) {
			this.logger.info(`Missing data sources detected: ${missingData.join(', ')}`);
			this.logger.info('Starting download of missing data sources...');

			await this.downloadMissingDataSources(config);
		} else {
			this.logger.info('All configured data sources are available');
		}
	}

	@bindThis
	private async checkOSMDataExists(): Promise<boolean> {
		try {
			const osmFiles = [
				'planet-latest.osm.pbf',
				'osm_data_processed.json'
			];

			for (const filename of osmFiles) {
				try {
					const filePath = path.join(this.syncDataPath, filename);
					await fs.access(filePath);
					const stats = await fs.stat(filePath);
					if (stats.size > 0) {
						this.logger.info(`Found existing OSM data: ${filename}`);
						return true;
					}
				} catch (error) {
				}
			}

			return false;
		} catch (error) {
			this.logger.warn('Error checking OSM data existence:', error as Error);
			return false;
		}
	}

	@bindThis
	private async checkFullGeoNamesDataExists(): Promise<boolean> {
		try {
			const geoNamesFiles = [
				'allCountries.zip',
				'allCountries.txt',
				'geonames_full_processed.json'
			];

			for (const filename of geoNamesFiles) {
				try {
					const filePath = path.join(this.syncDataPath, filename);
					await fs.access(filePath);
					const stats = await fs.stat(filePath);
					if (stats.size > 0) {
						this.logger.info(`Found existing full GeoNames data: ${filename}`);
						return true;
					}
				} catch (error) {
				}
			}

			return false;
		} catch (error) {
			this.logger.warn('Error checking full GeoNames data existence:', error as Error);
			return false;
		}
	}

	@bindThis
	private async downloadMissingDataSources(config: any): Promise<void> {
		const results: GeoDataEntry[] = [];

		try {
			if (config.downloadOSM) {
				const osmDataExists = await this.checkOSMDataExists();
				if (!osmDataExists) {
					this.logger.info('Downloading missing OSM data...');
					const osmData = await this.downloadAndProcessOSMPBF();
					for (const entry of osmData) {
						results.push(entry);
					}
					this.logger.info(`OSM data download completed: ${osmData.length} entries`);
				}
			}

			if (config.downloadFullGeoNames !== false) {
				const hasFullGeoNames = await this.checkFullGeoNamesDataExists();
				if (!hasFullGeoNames) {
					this.logger.info('Downloading missing GeoNames data...');
					const geoNamesData = config.downloadFullGeoNames === true
						? await this.downloadAndProcessFullGeoNames()
						: await this.downloadAndProcessGeoNamesCities();
					for (const entry of geoNamesData) {
						results.push(entry);
					}
					this.logger.info(`GeoNames data download completed: ${geoNamesData.length} entries`);
				}
			}

			if (results.length > 0) {
				this.logger.info(`Merging ${results.length} new entries with existing data...`);

				for (const entry of results) {
					this.geoData.push(entry);
				}

				const optimizedData = await this.optimizeGeoData(this.geoData);
				this.geoData = optimizedData;

				this.buildSpatialIndex();

				if (optimizedData.length > this.COMPRESS_THRESHOLD && !this.elasticClient) {
					await this.convertToBinaryFormat(optimizedData);
				} else {
					await this.saveOptimizedDataAsJSON(optimizedData);
				}

				this.logger.info(`Data merge completed: ${optimizedData.length} total entries`);
			}
		} catch (error) {
			this.logger.error('Error downloading missing data sources:', error as Error);
		}
	}
}
