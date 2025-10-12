/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { type Config, FulltextSearchProvider } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { MiNote } from '@/models/Note.js';
import type { NotesRepository, ElasticsearchReindexStatesRepository } from '@/models/_.js';
import { MiUser } from '@/models/_.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { CacheService } from '@/core/CacheService.js';
import { QueryService } from '@/core/QueryService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import type { Index, MeiliSearch } from 'meilisearch';
import type Logger from '@/logger.js';

type K = string;
type V = string | number | boolean;
type Q =
	{ op: '=', k: K, v: V } |
	{ op: '!=', k: K, v: V } |
	{ op: '>', k: K, v: number } |
	{ op: '<', k: K, v: number } |
	{ op: '>=', k: K, v: number } |
	{ op: '<=', k: K, v: number } |
	{ op: 'is null', k: K } |
	{ op: 'is not null', k: K } |
	{ op: 'and', qs: Q[] } |
	{ op: 'or', qs: Q[] } |
	{ op: 'not', q: Q };

type ElasticsearchIndexInfo = {
	index: string;
	health?: string;
	status?: string;
	'docs.count'?: string;
	'docs.deleted'?: string;
	'store.size'?: string;
};

export type SearchOpts = {
	userId?: MiNote['userId'] | null;
	channelId?: MiNote['channelId'] | null;
	host?: string | null;
};

export type SearchPagination = {
	untilId?: MiNote['id'];
	sinceId?: MiNote['id'];
	limit: number;
};

function compileValue(value: V): string {
	if (typeof value === 'string') {
		return `'${value}'`; // TODO: escape
	} else if (typeof value === 'number') {
		return value.toString();
	} else {
		return value.toString();
	}
}

function compileQuery(q: Q): string {
	switch (q.op) {
		case '=': return `(${q.k} = ${compileValue(q.v)})`;
		case '!=': return `(${q.k} != ${compileValue(q.v)})`;
		case '>': return `(${q.k} > ${compileValue(q.v)})`;
		case '<': return `(${q.k} < ${compileValue(q.v)})`;
		case '>=': return `(${q.k} >= ${compileValue(q.v)})`;
		case '<=': return `(${q.k} <= ${compileValue(q.v)})`;
		case 'and': return q.qs.length === 0 ? '' : `(${ q.qs.map(_q => compileQuery(_q)).join(' AND ') })`;
		case 'or': return q.qs.length === 0 ? '' : `(${ q.qs.map(_q => compileQuery(_q)).join(' OR ') })`;
		case 'is null': return `(${q.k} IS NULL)`;
		case 'is not null': return `(${q.k} IS NOT NULL)`;
		case 'not': return `(NOT ${compileQuery(q.q)})`;
		default: throw new Error('unrecognized query operator');
	}
}

@Injectable()
export class SearchService {
	private readonly meilisearchIndexScope: 'local' | 'global' | string[] = 'local';
	private readonly meilisearchNoteIndex: Index | null = null;
	private readonly provider: FulltextSearchProvider;
	private elasticsearchWriteIndex: string | null = null;
	private elasticsearchSearchIndex: string | null = null;
	private reindexingIndices: Set<string> = new Set();
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meilisearch)
		private meilisearch: MeiliSearch | null,

		@Inject(DI.elasticsearch)
		private elasticsearch: ElasticSearch | null,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.elasticsearchReindexStatesRepository)
		private elasticsearchReindexStatesRepository: ElasticsearchReindexStatesRepository,

		private cacheService: CacheService,
		private queryService: QueryService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('SearchService');

		if (meilisearch) {
			this.meilisearchNoteIndex = meilisearch.index(`${config.meilisearch!.index}---notes`);
			this.meilisearchNoteIndex.updateSettings({
				searchableAttributes: [
					'text',
					'cw',
				],
				sortableAttributes: [
					'createdAt',
				],
				filterableAttributes: [
					'createdAt',
					'userId',
					'userHost',
					'channelId',
					'tags',
				],
				typoTolerance: {
					enabled: false,
				},
				pagination: {
					maxTotalHits: 10000,
				},
			});
		}

		if (!this.meilisearch && this.elasticsearch) {
			this.initializeElasticsearch().catch(err => {
				this.logger.error('Failed to initialize Elasticsearch:', err);
			});
		}

		if (config.meilisearch?.scope) {
			this.meilisearchIndexScope = config.meilisearch.scope;
		}

		this.provider = config.fulltextSearch?.provider ?? 'sqlLike';
		this.logger.info(`-- Provider: ${this.provider === 'searchengine' ? 'Search Engine' : this.provider}`);
	}

	@bindThis
	private getElasticsearchIndexConfig() {
		return {
			mappings: {
				properties: {
					text: {
						type: 'text' as const,
						analyzer: 'optimized_analyzer',
						search_analyzer: 'optimized_search_analyzer',
						index_options: 'freqs' as const,
						fields: {
							phrase: {
								type: 'text' as const,
								analyzer: 'phrase_analyzer',
								search_analyzer: 'phrase_analyzer',
							},
							keyword: {
								type: 'keyword' as const,
							},
							exact: {
								type: 'text' as const,
								analyzer: 'keyword',
								index_options: 'docs' as const,
							},
						},
					},
					cw: {
						type: 'text' as const,
						analyzer: 'optimized_analyzer',
						search_analyzer: 'optimized_search_analyzer',
						index_options: 'freqs' as const,
						fields: {
							phrase: {
								type: 'text' as const,
								analyzer: 'phrase_analyzer',
								search_analyzer: 'phrase_analyzer',
							},
						},
					},
					createdAt: { type: 'long' as const },
					userId: { type: 'keyword' as const },
					userHost: { type: 'keyword' as const },
					channelId: { type: 'keyword' as const },
					tags: { type: 'keyword' as const },
				},
			},
			settings: {
				analysis: {
					analyzer: {
						optimized_analyzer: {
							type: 'custom' as const,
							tokenizer: 'ik_max_word',
							filter: ['lowercase', 'trim'],
						},
						optimized_search_analyzer: {
							type: 'custom' as const,
							tokenizer: 'ik_smart',
							filter: ['lowercase', 'trim'],
						},
						phrase_analyzer: {
							type: 'custom' as const,
							tokenizer: 'ik_smart',
							filter: ['lowercase', 'trim'],
						},
					},
					tokenizer: {
						custom_tokenizer: {
							type: 'pattern' as const,
							pattern: '[\\s\\p{P}]+',
							flags: 'CASE_INSENSITIVE',
						},
					},
				},
				number_of_shards: 1,
				number_of_replicas: 0,
				refresh_interval: '30s',
				max_result_window: 50000,
				similarity: {
					default: {
						type: 'BM25' as const,
						k1: 1.5,
						b: 0.75,
					},
				},
			},
		};
	}

	@bindThis
	private async initializeElasticsearch() {
		if (!this.elasticsearch) return;

		const base = `${this.config.elasticsearch!.index}---notes`;
		const month = new Date().toISOString().slice(0, 7).replace(/-/g, '');
		const prefix = `${base}-${month}`;
		const MAX_DOCS = 5_000_000;

		await this.cleanupCompletedReindex();
		await this.resumePendingReindex();

		let i = 0;
		while (true) {
			const aliasName = i === 0 ? prefix : `${prefix}-${i}`;

			const aliasExists = await this.elasticsearch.indices.existsAlias({ name: aliasName });
			if (aliasExists) {
				await this.checkAndUpdateIndexConfig(aliasName);

				const aliasInfo = await this.elasticsearch.indices.getAlias({ name: aliasName });
				const realIndexName = Object.keys(aliasInfo)[0];

				const { count } = await this.elasticsearch.count({ index: realIndexName });
				if (count < MAX_DOCS) {
					this.elasticsearchWriteIndex = realIndexName;
					break;
				}
				i++;
				continue;
			}

			const indexExists = await this.elasticsearch.indices.exists({ index: aliasName });
			if (indexExists) {
				await this.checkAndUpdateIndexConfig(aliasName);

				const { count } = await this.elasticsearch.count({ index: aliasName });
				if (count < MAX_DOCS) {
					this.elasticsearchWriteIndex = aliasName;
					break;
				}
				i++;
				continue;
			}

			const realIndexName = `${aliasName}-v1`;
			const config = this.getElasticsearchIndexConfig();
			await this.elasticsearch.indices.create({
				index: realIndexName,
				mappings: config.mappings,
				settings: config.settings,
				aliases: { [aliasName]: {} },
			});
			this.elasticsearchWriteIndex = realIndexName;
			this.logger.info(`Created new Elasticsearch index: ${realIndexName} with alias: ${aliasName}`);
			break;
		}

		this.elasticsearchSearchIndex = `${base}*`;

		await this.checkAllIndicesConfig(base);
	}

	@bindThis
	private async checkAllIndicesConfig(base: string) {
		if (!this.elasticsearch) return;

		try {
			const allIndices = await this.elasticsearch.cat.indices({ index: `${base}*`, format: 'json' }) as ElasticsearchIndexInfo[];
			const currentMonth = new Date().toISOString().slice(0, 7).replace(/-/g, '');
			const currentPrefix = `${base}-${currentMonth}`;

			for (const indexInfo of allIndices) {
				const indexName = indexInfo.index;

				if (indexName.includes('-reindex-')) {
					continue;
				}

				if (indexName.startsWith(currentPrefix)) {
					continue;
				}

				const aliasExists = await this.elasticsearch.indices.existsAlias({ name: indexName });
				if (aliasExists) {
					this.logger.info(`Checking historical index alias: ${indexName}`);
					await this.checkAndUpdateIndexConfig(indexName);
				} else {
					this.logger.info(`Checking historical index: ${indexName}`);
					await this.checkAndUpdateIndexConfig(indexName);
				}

				if (this.reindexingIndices.size >= 1) {
					this.logger.info('Reindex limit reached, will check remaining indices on next startup');
					break;
				}
			}
		} catch (error) {
			this.logger.error('Failed to check all indices config:', (error as Error));
		}
	}

	@bindThis
	private async checkAndUpdateIndexConfig(indexName: string) {
		if (!this.elasticsearch) return;

		try {
			const desiredConfig = this.getElasticsearchIndexConfig();
			const currentSettings = await this.elasticsearch.indices.getSettings({ index: indexName });
			const currentMappings = await this.elasticsearch.indices.getMapping({ index: indexName });

			const realIndexName = Object.keys(currentSettings)[0];
			const currentIndexSettings = currentSettings[realIndexName]?.settings;
			const currentIndexMappings = currentMappings[realIndexName]?.mappings;

			const diff = this.detectConfigDifferences(
				{ settings: currentIndexSettings, mappings: currentIndexMappings },
				desiredConfig,
			);

			if (diff.hasHotUpdateableChanges) {
				this.logger.info(`Applying hot-updatable settings to index ${indexName}`);
				await this.applyHotUpdates(indexName, diff.hotUpdates);
			}

			if (diff.requiresReindex) {
				this.logger.warn(`Index ${indexName} requires reindex: ${diff.reason.join(', ')}`);

				const { count } = await this.elasticsearch.count({ index: indexName });
				if (count === 0) {
					this.logger.info(`Index ${indexName} is empty (${count} docs), recreating instead of reindexing`);
					try {
						const aliasExists = await this.elasticsearch.indices.existsAlias({ name: indexName });

						if (aliasExists) {
							const aliasInfo = await this.elasticsearch.indices.getAlias({ name: indexName });
							const realIndexName = Object.keys(aliasInfo)[0];
							this.logger.info(`Index ${indexName} is an alias pointing to ${realIndexName}`);

							await this.elasticsearch.indices.delete({ index: realIndexName });

							const newRealIndexName = `${indexName}-v${Date.now()}`;
							await this.elasticsearch.indices.create({
								index: newRealIndexName,
								mappings: desiredConfig.mappings,
								settings: desiredConfig.settings,
								aliases: { [indexName]: {} },
							});
							this.logger.info(`Successfully recreated empty index ${realIndexName} as ${newRealIndexName} with alias ${indexName}`);
						} else {
							await this.elasticsearch.indices.delete({ index: indexName });
							await this.elasticsearch.indices.create({
								index: indexName,
								mappings: desiredConfig.mappings,
								settings: desiredConfig.settings,
							});
							this.logger.info(`Successfully recreated empty index ${indexName}`);
						}
						return;
					} catch (error) {
						this.logger.error(`Failed to recreate empty index ${indexName}:`, (error as Error));
					}
				}

				await this.startReindexProcess(indexName, desiredConfig);
			}
		} catch (error) {
			this.logger.error(`Failed to check index config for ${indexName}:`, (error as Error));
		}
	}

	@bindThis
	private normalizeValue(value: any): string {
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'number') return String(value);
		if (typeof value === 'string') return value;
		return JSON.stringify(value);
	}

	@bindThis
	private detectConfigDifferences(current: any, desired: any) {
		const result = {
			hasHotUpdateableChanges: false,
			hotUpdates: {} as any,
			requiresReindex: false,
			reason: [] as string[],
		};

		const hotUpdateableSettings = [
			'refresh_interval',
			'number_of_replicas',
			'max_result_window',
		];

		for (const key of hotUpdateableSettings) {
			const currentValue = current.settings?.index?.[key];
			const desiredValue = desired.settings?.[key];
			if (currentValue !== undefined && desiredValue !== undefined) {
				const currentNorm = this.normalizeValue(currentValue);
				const desiredNorm = this.normalizeValue(desiredValue);
				if (currentNorm !== desiredNorm) {
					result.hasHotUpdateableChanges = true;
					if (!result.hotUpdates.settings) result.hotUpdates.settings = {};
					result.hotUpdates.settings[key] = desiredValue;
				}
			}
		}

		const immutableIndexSettings = ['number_of_shards'];
		for (const key of immutableIndexSettings) {
			const currentValue = current.settings?.index?.[key];
			const desiredValue = desired.settings?.[key];
			const currentNorm = this.normalizeValue(currentValue);
			const desiredNorm = this.normalizeValue(desiredValue);
			if (currentNorm !== desiredNorm) {
				result.requiresReindex = true;
				result.reason.push(`Setting '${key}' changed: ${currentNorm} -> ${desiredNorm}`);
			}
		}

		const analyzerKeys = ['optimized_analyzer', 'optimized_search_analyzer', 'phrase_analyzer'];
		for (const analyzerKey of analyzerKeys) {
			const currentAnalyzer = current.settings?.index?.analysis?.analyzer?.[analyzerKey]
				?? current.settings?.analysis?.analyzer?.[analyzerKey];
			const desiredAnalyzer = desired.settings?.analysis?.analyzer?.[analyzerKey];

			if (!currentAnalyzer && desiredAnalyzer) {
				result.requiresReindex = true;
				result.reason.push(`Analyzer '${analyzerKey}' added`);
				continue;
			}

			if (currentAnalyzer && !desiredAnalyzer) {
				result.requiresReindex = true;
				result.reason.push(`Analyzer '${analyzerKey}' removed`);
				continue;
			}

			if (currentAnalyzer && desiredAnalyzer) {
				const currentTokenizer = currentAnalyzer.tokenizer;
				const desiredTokenizer = desiredAnalyzer.tokenizer;
				if (currentTokenizer !== desiredTokenizer) {
					result.requiresReindex = true;
					result.reason.push(`Analyzer '${analyzerKey}' tokenizer changed`);
				}

				const currentFilter = JSON.stringify(currentAnalyzer.filter ?? []);
				const desiredFilter = JSON.stringify(desiredAnalyzer.filter ?? []);
				if (currentFilter !== desiredFilter) {
					result.requiresReindex = true;
					result.reason.push(`Analyzer '${analyzerKey}' filter changed`);
				}
			}
		}

		const checkFieldMapping = (path: string, currentField: any, desiredField: any): boolean => {
			if (!currentField && desiredField) {
				result.requiresReindex = true;
				result.reason.push(`Field '${path}' added`);
				return true;
			}
			if (!desiredField) return false;

			if (currentField.type !== desiredField.type) {
				result.requiresReindex = true;
				result.reason.push(`Field '${path}' type changed`);
				return true;
			}

			if (currentField.analyzer !== desiredField.analyzer) {
				result.requiresReindex = true;
				result.reason.push(`Field '${path}' analyzer changed`);
				return true;
			}

			const getIndexOptions = (field: any) => {
				if (field.index_options) return field.index_options;
				if (field.type === 'text') return 'positions';
				return undefined;
			};

			const currentIndexOptions = getIndexOptions(currentField);
			const desiredIndexOptions = getIndexOptions(desiredField);
			if (currentIndexOptions !== desiredIndexOptions) {
				result.requiresReindex = true;
				result.reason.push(`Field '${path}' index_options changed: ${currentIndexOptions} -> ${desiredIndexOptions}`);
				return true;
			}

			return false;
		};

		const desiredProps = desired.mappings?.properties ?? {};
		const currentProps = current.mappings?.properties ?? {};

		for (const fieldName of Object.keys(desiredProps)) {
			const desiredField = desiredProps[fieldName];
			const currentField = currentProps[fieldName];

			if (checkFieldMapping(fieldName, currentField, desiredField)) continue;

			if (desiredField.fields) {
				for (const subFieldName of Object.keys(desiredField.fields)) {
					const subPath = `${fieldName}.${subFieldName}`;
					checkFieldMapping(subPath, currentField?.fields?.[subFieldName], desiredField.fields[subFieldName]);
				}
			}
		}

		return result;
	}

	@bindThis
	private async applyHotUpdates(indexName: string, updates: any) {
		if (!this.elasticsearch) return;

		try {
			if (updates.settings) {
				await this.elasticsearch.indices.putSettings({
					index: indexName,
					settings: updates.settings,
				});
				this.logger.info(`Applied hot updates to ${indexName}:`, updates.settings);
			}
		} catch (error) {
			this.logger.error(`Failed to apply hot updates to ${indexName}:`, (error as Error));
		}
	}

	@bindThis
	private async startReindexProcess(oldIndex: string, targetConfig: any) {
		if (!this.elasticsearch) return;
		if (this.reindexingIndices.size >= 1) {
			this.logger.warn(`Reindex limit reached (${this.reindexingIndices.size}/1), will retry later for ${oldIndex}`);
			return;
		}

		const indexPattern = oldIndex;

		try {
			let state = await this.elasticsearchReindexStatesRepository.findOneBy({ indexPattern });
			if (!state) {
				state = this.elasticsearchReindexStatesRepository.create({
					indexPattern,
					status: 'pending',
					oldIndex,
					newIndex: null,
					taskId: null,
					targetConfig,
					retryCount: 0,
					errorMessage: null,
					startedAt: null,
					completedAt: null,
				});
				await this.elasticsearchReindexStatesRepository.save(state);
			} else if (state.status === 'in_progress') {
				this.logger.info('Reindex task already exists, resuming');
				await this.resumeReindex(state);
				return;
			}

			await this.executeReindex(state);
		} catch (error: any) {
			this.logger.error('Failed to start reindex:', error);
			await this.handleReindexError(indexPattern, error);
		}
	}

	@bindThis
	private async executeReindex(state: any) {
		if (!this.elasticsearch) return;
		if (!state.oldIndex) {
			this.logger.error('Reindex state has no oldIndex');
			return;
		}

		this.reindexingIndices.add(state.oldIndex);
		const maxRetries = 5;
		let newIndexCreated = false;

		try {
			const sourceExists = await this.elasticsearch.indices.exists({ index: state.oldIndex });
			if (!sourceExists) {
				throw new Error(`Source index does not exist: ${state.oldIndex}`);
			}

			const base = `${this.config.elasticsearch!.index}---notes`;
			const existingReindexIndices = await this.elasticsearch.cat.indices({
				index: `${base}*-reindex-*`,
				format: 'json'
			}) as ElasticsearchIndexInfo[];

			const conflictingIndex = existingReindexIndices.find(idx =>
				idx.index.startsWith(`${state.oldIndex}-reindex-`)
			);

			if (conflictingIndex) {
				this.logger.warn(`Reindex already in progress for ${state.oldIndex}: ${conflictingIndex.index}`);
				this.reindexingIndices.delete(state.oldIndex);
				return;
			}

			const sourceStats = await this.elasticsearch.count({ index: state.oldIndex });
			this.logger.info(`Source index ${state.oldIndex} has ${sourceStats.count} documents`);

			state.status = 'in_progress';
			state.startedAt = new Date();
			await this.elasticsearchReindexStatesRepository.save(state);

			const newIndexName = `${state.oldIndex}-reindex-${Date.now()}`;
			await this.elasticsearch.indices.create({
				index: newIndexName,
				mappings: state.targetConfig.mappings,
				settings: state.targetConfig.settings,
			});
			newIndexCreated = true;
			this.logger.info(`Created new index for reindex: ${newIndexName}`);

			state.newIndex = newIndexName;
			await this.elasticsearchReindexStatesRepository.save(state);

			this.logger.info(`Starting reindex from ${state.oldIndex} to ${newIndexName}`);
			const reindexResponse = await this.elasticsearch.reindex({
				wait_for_completion: false,
				source: { index: state.oldIndex },
				dest: { index: newIndexName },
			});

			this.logger.info(`Reindex response: ${JSON.stringify(reindexResponse ?? {}, null, 2)}`);

			state.taskId = reindexResponse.task as string;
			await this.elasticsearchReindexStatesRepository.save(state);
			this.logger.info(`Reindex task started: ${state.taskId}`);

			await this.monitorReindexTask(state);
		} catch (error: any) {
			this.reindexingIndices.delete(state.oldIndex);

			if (newIndexCreated && state.newIndex) {
				try {
					const indexExists = await this.elasticsearch!.indices.exists({ index: state.newIndex });
					if (indexExists) {
						await this.elasticsearch!.indices.delete({ index: state.newIndex });
						this.logger.info(`Cleaned up failed reindex index: ${state.newIndex}`);
					}
				} catch (cleanupError) {
					this.logger.error(`Failed to cleanup index ${state.newIndex}:`, (cleanupError as Error));
				}
			}

			state.retryCount++;

			if (state.retryCount < maxRetries) {
				const backoffMs = Math.min(1000 * Math.pow(2, state.retryCount), 60000);
				this.logger.warn(`Reindex failed, retry ${state.retryCount}/${maxRetries} in ${backoffMs}ms`);
				state.errorMessage = error.message;
				state.newIndex = null;
				await this.elasticsearchReindexStatesRepository.save(state);

				setTimeout(() => {
					this.executeReindex(state).catch(err => {
						this.logger.error('Retry failed:', err);
					});
				}, backoffMs);
			} else {
				state.status = 'failed';
				state.errorMessage = `Max retries exceeded: ${error.message}`;
				await this.elasticsearchReindexStatesRepository.save(state);
				this.logger.error('Reindex failed after max retries:', error);
			}
		}
	}

	@bindThis
	private async monitorReindexTask(state: any) {
		if (!this.elasticsearch || !state.taskId) return;

		const checkInterval = 5000;
		const maxWaitTime = 6 * 3600000;
		const startTime = Date.now();

		const check = async () => {
			try {
				const taskStatus = await this.elasticsearch!.tasks.get({ task_id: state.taskId });

				this.logger.debug(`Reindex task status: ${JSON.stringify(taskStatus ?? {}, null, 2)}`);

				if (taskStatus.completed) {
					this.logger.info(`Reindex task completed. Full response: ${JSON.stringify(taskStatus.response ?? {}, null, 2)}`);

					if (taskStatus.error) {
						throw new Error(`Reindex task failed: ${JSON.stringify(taskStatus.error ?? null)}`);
					}

					const response = taskStatus.response as any;
					if (response) {
						this.logger.info(`Reindex stats: total=${response.total}, created=${response.created}, updated=${response.updated}, deleted=${response.deleted}, failures=${response.failures?.length || 0}`);
						if (response.failures && response.failures.length > 0) {
							this.logger.error(`Reindex failures: ${JSON.stringify(response.failures ?? [], null, 2)}`);
						}
					}

					this.logger.info('Reindex task completed, switching indices');
					await this.switchToNewIndex(state, response);
					return;
				}
				const task = taskStatus.task as any;
				if (task?.status) {
					const progress = task.status;
					this.logger.info(`Reindex progress: ${progress.created || 0}/${progress.total || 0} documents`);
				}

				if (Date.now() - startTime > maxWaitTime) {
					throw new Error('Reindex task timeout');
				}

				setTimeout(check, checkInterval);
			} catch (error: any) {
				this.logger.error('Error monitoring reindex task:', error);
				state.status = 'failed';
				state.errorMessage = error.message;
				await this.elasticsearchReindexStatesRepository.save(state);
				this.reindexingIndices.delete(state.oldIndex);
			}
		};

		await check();
	}

	@bindThis
	private async switchToNewIndex(state: any, reindexResponse: any) {
		if (!this.elasticsearch) return;
		if (!state.oldIndex || !state.newIndex) {
			this.logger.error('Reindex state has no oldIndex or newIndex');
			return;
		}

		try {
			const reindexedCount = reindexResponse?.created || 0;
			const expectedCount = reindexResponse?.total || 0;
			const failedCount = reindexResponse?.failures?.length || 0;

			this.logger.info(`Reindex verification - expected: ${expectedCount}, created: ${reindexedCount}, failed: ${failedCount}`);

			if (failedCount > 0) {
				throw new Error(`Reindex had ${failedCount} failures, will not switch to new index`);
			}

			if (expectedCount > 0 && reindexedCount < expectedCount * 0.95) {
				throw new Error(`Reindex incomplete: only ${reindexedCount}/${expectedCount} documents created`);
			}

			if (expectedCount === 0 && reindexedCount === 0) {
				this.logger.info(`Source index was empty, reindex completed with 0 documents`);
			}

			this.logger.info('Refreshing new index to ensure documents are queryable...');
			await this.elasticsearch.indices.refresh({ index: state.newIndex });

			const healthCheck = await this.elasticsearch.cat.indices({
				index: state.newIndex,
				format: 'json',
				h: ['index', 'health', 'status', 'docs.count']
			}) as ElasticsearchIndexInfo[];

			if (healthCheck.length === 0) {
				throw new Error(`New index ${state.newIndex} not found during health check`);
			}

			const indexHealth = healthCheck[0];
			this.logger.info(`New index health: ${indexHealth.health}, status: ${indexHealth.status}, docs: ${indexHealth['docs.count']}`);

			if (indexHealth.health === 'red') {
				throw new Error(`New index ${state.newIndex} has red health status, not safe to switch`);
			}

			const actualCount = parseInt(indexHealth['docs.count'] || '0', 10);
			if (expectedCount > 0 && actualCount < expectedCount * 0.95) {
				throw new Error(`New index document count mismatch: expected ${expectedCount}, got ${actualCount}`);
			}

			const aliasExists = await this.elasticsearch.indices.existsAlias({ name: state.oldIndex });
			const indexExists = await this.elasticsearch.indices.exists({ index: state.oldIndex });

			if (aliasExists) {
				const aliasInfo = await this.elasticsearch.indices.getAlias({ name: state.oldIndex });
				const oldRealIndex = Object.keys(aliasInfo)[0];

				await this.elasticsearch.indices.updateAliases({
					actions: [
						{ remove: { index: oldRealIndex, alias: state.oldIndex } },
						{ add: { index: state.newIndex, alias: state.oldIndex } },
					],
				});

				this.logger.info(`Switched alias ${state.oldIndex} from ${oldRealIndex} to ${state.newIndex}`);

				setTimeout(async () => {
					try {
						await this.elasticsearch!.indices.delete({ index: oldRealIndex });
						this.logger.info(`Deleted old index: ${oldRealIndex}`);
					} catch (error) {
						this.logger.error(`Failed to delete old index ${oldRealIndex}:`, (error as Error));
					}
				}, 60000);
			} else if (indexExists) {
				await this.elasticsearch.indices.updateAliases({
					actions: [
						{ remove_index: { index: state.oldIndex } },
						{ add: { index: state.newIndex, alias: state.oldIndex } },
					],
				});
				this.logger.info(`Replaced index ${state.oldIndex} with alias pointing to ${state.newIndex}`);
			} else {
				await this.elasticsearch.indices.putAlias({
					index: state.newIndex,
					name: state.oldIndex,
				});
				this.logger.info(`Created alias ${state.oldIndex} -> ${state.newIndex}`);
			}

			if (this.elasticsearchWriteIndex === state.oldIndex) {
				this.elasticsearchWriteIndex = state.newIndex;
			}

			state.status = 'completed';
			state.completedAt = new Date();
			await this.elasticsearchReindexStatesRepository.save(state);

			this.reindexingIndices.delete(state.oldIndex);
			this.logger.info(`Reindex completed successfully for ${state.oldIndex}`);
		} catch (error: any) {
			state.status = 'failed';
			state.errorMessage = error.message;
			await this.elasticsearchReindexStatesRepository.save(state);
			this.reindexingIndices.delete(state.oldIndex);
			this.logger.error('Failed to switch to new index:', error);
		}
	}

	@bindThis
	private async cleanupCompletedReindex() {
		if (!this.elasticsearch) return;

		try {
			const completedStates = await this.elasticsearchReindexStatesRepository.findBy({
				status: 'completed' as any,
			});

			const base = `${this.config.elasticsearch!.index}---notes`;
			const allIndices = await this.elasticsearch.cat.indices({ index: `${base}*`, format: 'json' }) as ElasticsearchIndexInfo[];
			const existingIndices = new Set(allIndices.map(idx => idx.index));

			for (const state of completedStates) {
				if (!state.oldIndex || !state.newIndex) continue;

				const oldIndex = state.oldIndex;
				const newIndex = state.newIndex;

				const aliasExists = await this.elasticsearch.indices.existsAlias({ name: oldIndex });
				if (aliasExists) {
					const aliasInfo = await this.elasticsearch.indices.getAlias({ name: oldIndex });
					const currentTarget = Object.keys(aliasInfo)[0];

					if (currentTarget === newIndex && existingIndices.has(oldIndex) && oldIndex.includes('-reindex-')) {
						const nonAliasIndex = Array.from(existingIndices).find(idx =>
							idx !== newIndex && idx.startsWith(oldIndex.split('-reindex-')[0])
						);
						if (nonAliasIndex) {
							this.logger.info(`Cleanup: deleting orphaned index ${nonAliasIndex}`);
							await this.elasticsearch.indices.delete({ index: nonAliasIndex });
							await this.elasticsearchReindexStatesRepository.remove(state);
						}
					}
				} else if (existingIndices.has(oldIndex)) {
					if (oldIndex.includes('-reindex-')) {
						this.logger.warn(`Cleanup: old index ${oldIndex} still exists without alias, cleaning up state`);
						await this.elasticsearchReindexStatesRepository.remove(state);
					}
				} else {
					this.logger.info(`Cleanup: removing completed reindex state for non-existent index ${oldIndex}`);
					await this.elasticsearchReindexStatesRepository.remove(state);
				}
			}
		} catch (error) {
			this.logger.error('Failed to cleanup completed reindex:', (error as Error));
		}
	}

	@bindThis
	private async resumePendingReindex() {
		if (!this.elasticsearch) return;

		try {
			const pendingStates = await this.elasticsearchReindexStatesRepository.findBy({
				status: 'in_progress' as any,
			});

			for (const state of pendingStates) {
				if (this.reindexingIndices.size >= 1) {
					this.logger.info(`Reindex limit reached, skipping resume of ${state.indexPattern}`);
					break;
				}
				this.logger.info(`Found pending reindex task for ${state.indexPattern}, resuming`);
				await this.resumeReindex(state);
			}
		} catch (error) {
			this.logger.error('Failed to resume pending reindex:', (error as Error));
		}
	}

	@bindThis
	private async resumeReindex(state: any) {
		if (!this.elasticsearch) return;

		if (state.taskId) {
			try {
				await this.monitorReindexTask(state);
			} catch (error) {
				this.logger.warn('Task no longer exists, restarting reindex');
				state.taskId = null;
				await this.elasticsearchReindexStatesRepository.save(state);
				await this.executeReindex(state);
			}
		} else {
			await this.executeReindex(state);
		}
	}

	@bindThis
	private async handleReindexError(indexPattern: string, error: any) {
		try {
			const state = await this.elasticsearchReindexStatesRepository.findOneBy({ indexPattern });
			if (state) {
				state.status = 'failed';
				state.errorMessage = error.message;
				await this.elasticsearchReindexStatesRepository.save(state);
			}
		} catch (err) {
			this.logger.error('Failed to handle reindex error:', (err as Error));
		}
	}

	@bindThis
	public async indexNote(note: MiNote): Promise<void> {
		if (note.text == null && note.cw == null) return;
		if (!['home', 'public'].includes(note.visibility)) return;

		if (this.meilisearch) {
			switch (this.meilisearchIndexScope) {
				case 'global':
					break;

				case 'local':
					if (note.userHost == null) break;
					return;

				default: {
					if (note.userHost == null) break;
					if (this.meilisearchIndexScope.includes(note.userHost)) break;
					return;
				}
			}

			await this.meilisearchNoteIndex?.addDocuments([{
				id: note.id,
				createdAt: this.idService.parse(note.id).date.getTime(),
				userId: note.userId,
				userHost: note.userHost,
				channelId: note.channelId,
				cw: note.cw,
				text: note.text,
				tags: note.tags,
			}], {
				primaryKey: 'id',
			});
		}

		if (!this.meilisearch && this.elasticsearch) {
			const document = {
				createdAt: this.idService.parse(note.id).date.getTime(),
				userId: note.userId,
				userHost: note.userHost,
				channelId: note.channelId,
				cw: note.cw,
				text: note.text,
				tags: note.tags,
			};

			if (!this.meilisearch && this.elasticsearch && this.elasticsearchWriteIndex) {
				await this.elasticsearch.index({
					index: this.elasticsearchWriteIndex,
					id: note.id,
					document: document,
				});
			}
		}
	}

	@bindThis
	public async unindexNote(note: MiNote): Promise<void> {
		if (!['home', 'public'].includes(note.visibility)) return;

		if (this.meilisearch) {
			await this.meilisearchNoteIndex!.deleteDocument(note.id);
		}

		if (!this.meilisearch && this.elasticsearch && this.elasticsearchSearchIndex) {
			await this.elasticsearch.deleteByQuery({
				index: this.elasticsearchSearchIndex,
				query: {
					term: {
						_id: note.id,
					},
				},
			});
		}
	}

	@bindThis
	private buildOptimizedESQuery(q: string) {
		const cleanQuery = q.trim().replace(/[*?]/g, '');
		const isExactPhrase = /^".*"$/.test(q);

		if (isExactPhrase) {
			const phrase = cleanQuery.replace(/"/g, '');
			return {
				bool: {
					should: [
						{ match_phrase: { 'text.phrase': { query: phrase, boost: 10 } } },
						{ match_phrase: { 'cw.phrase': { query: phrase, boost: 8 } } },
					],
					minimum_should_match: 1,
				},
			};
		} else {
			return {
				bool: {
					should: [
						{ term: { 'text.keyword': { value: cleanQuery, boost: 15 } } },
						{ match_phrase: { 'text.phrase': { query: cleanQuery, boost: 12 } } },
						{ match_phrase: { 'cw.phrase': { query: cleanQuery, boost: 10 } } },
						{ match: { text: { query: cleanQuery, operator: 'and', boost: 8 } } },
						{ match: { cw: { query: cleanQuery, operator: 'and', boost: 6 } } },
						{ match: { text: { query: cleanQuery, operator: 'or', boost: 4, minimum_should_match: '50%' } } },
						{ match: { cw: { query: cleanQuery, operator: 'or', boost: 3, minimum_should_match: '50%' } } },
						{ multi_match: { query: cleanQuery, fields: ['text^2', 'cw^1.5'], type: 'best_fields', boost: 2, fuzziness: 'AUTO', minimum_should_match: '30%' } },
						{ fuzzy: { text: { value: cleanQuery, fuzziness: 'AUTO', boost: 1, max_expansions: 10 } } },
					],
					minimum_should_match: 1,
				},
			};
		}
	}

	@bindThis
	private async searchNoteByLike(
		q: string,
		me: MiUser | null,
		opts: SearchOpts,
		pagination: SearchPagination,
	): Promise<MiNote[]> {
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), pagination.sinceId, pagination.untilId);

		if (opts.userId) {
			query.andWhere('note.userId = :userId', { userId: opts.userId });
		} else if (opts.channelId) {
			query.andWhere('note.channelId = :channelId', { channelId: opts.channelId });
		}

		query
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');

		if (this.config.fulltextSearch?.provider === 'sqlPgroonga') {
			query.andWhere('note.text &@~ :q', { q });
		} else {
			query.andWhere('LOWER(note.text) LIKE :q', { q: `%${ sqlLikeEscape(q.toLowerCase()) }%` });
		}

		if (opts.host) {
			if (opts.host === '.') {
				query.andWhere('note.userHost IS NULL');
			} else {
				query.andWhere('note.userHost = :host', { host: opts.host });
			}
		}

		this.queryService.generateVisibilityQuery(query, me);
		this.queryService.generateBaseNoteFilteringQuery(query, me);

		return query.limit(pagination.limit).getMany();
	}

	@bindThis
	public async searchNote(
		q: string,
		me: MiUser | null,
		opts: SearchOpts,
		pagination: SearchPagination,
	): Promise<MiNote[]> {
		switch (this.provider) {
			case 'sqlLike':
			case 'sqlPgroonga':
				return this.searchNoteByLike(q, me, opts, pagination);
			case 'meilisearch':
			case 'SearchEngine':
			case 'searchEngine':
			case 'searchengine':
				return this.searchNoteBySearchEngine(q, me, opts, pagination);
			default:
				return [];
		}
	}

	@bindThis
	public async searchNoteBySearchEngine(q: string, me: MiUser | null, opts: SearchOpts, pagination: SearchPagination): Promise<MiNote[]> {
		if (this.meilisearch) {
			if (!this.meilisearchNoteIndex) {
				throw new Error('MeiliSearch is not available');
			}

			const filter: Q = { op: 'and', qs: [] };
			if (pagination.untilId) filter.qs.push({ op: '<', k: 'createdAt', v: this.idService.parse(pagination.untilId).date.getTime() });
			if (pagination.sinceId) filter.qs.push({ op: '>', k: 'createdAt', v: this.idService.parse(pagination.sinceId).date.getTime() });
			if (opts.userId) filter.qs.push({ op: '=', k: 'userId', v: opts.userId });
			if (opts.channelId) filter.qs.push({ op: '=', k: 'channelId', v: opts.channelId });
			if (opts.host) {
				if (opts.host === '.') {
					filter.qs.push({ op: 'is null', k: 'userHost' });
				} else {
					filter.qs.push({ op: '=', k: 'userHost', v: opts.host });
				}
			}

			const res = await this.meilisearchNoteIndex.search(q, {
				sort: ['createdAt:desc'],
				matchingStrategy: 'all',
				attributesToRetrieve: ['id', 'createdAt'],
				filter: compileQuery(filter),
				limit: pagination.limit,
			});

			if (res.hits.length === 0) return [];

			const [userIdsWhoMeMuting, userIdsWhoBlockingMe] = me
				? await Promise.all([
					this.cacheService.userMutingsCache.fetch(me.id),
					this.cacheService.userBlockedCache.fetch(me.id),
				])
				: [new Set<string>(), new Set<string>()];

			const query = this.notesRepository.createQueryBuilder('note')
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			query.where('note.id IN (:...noteIds)', { noteIds: res.hits.map(x => x.id) });

			this.queryService.generateSoftDeletedNoteQuery(query);
			this.queryService.generateBlockedHostQueryForNote(query);
			this.queryService.generateSuspendedUserQueryForNote(query);

			const notes = (await query.getMany()).filter(note => {
				if (me && isUserRelated(note, userIdsWhoBlockingMe)) return false;
				return !(me && isUserRelated(note, userIdsWhoMeMuting));
			});

			return notes.sort((a, b) => a.id > b.id ? -1 : 1);
		} else if (this.elasticsearch && this.elasticsearchSearchIndex) {
			const base = `${this.config.elasticsearch!.index}---notes`;
			let searchIndex = this.elasticsearchSearchIndex;

			try {
				const allIndices = await this.elasticsearch.cat.indices({ index: `${base}*`, format: 'json' }) as ElasticsearchIndexInfo[];
				const reindexIndices = allIndices.filter(idx => idx.index.includes('-reindex-'));

				if (reindexIndices.length > 0) {
					const availableIndices = allIndices
						.map(idx => idx.index)
						.filter(idx => !idx.includes('-reindex-'));

					if (availableIndices.length === 0) {
						this.logger.warn('All indices are reindexing, returning empty results');
						return [];
					}

					searchIndex = availableIndices.join(',');
					this.logger.debug(`Excluded reindex indices: ${reindexIndices.map(i => i.index).join(',')}`);
				}
			} catch (error) {
				this.logger.error('Failed to filter reindex indices:', (error as Error));
			}

			const esFilter: any = { bool: { must: [] } };
			if (pagination.untilId) esFilter.bool.must.push({ range: { createdAt: { lt: this.idService.parse(pagination.untilId).date.getTime() } } });
			if (pagination.sinceId) esFilter.bool.must.push({ range: { createdAt: { gt: this.idService.parse(pagination.sinceId).date.getTime() } } });
			if (opts.userId) esFilter.bool.must.push({ term: { userId: opts.userId } });
			if (opts.channelId) esFilter.bool.must.push({ term: { channelId: opts.channelId } });
			if (opts.host) {
				if (opts.host === '.') {
					esFilter.bool.must.push({ bool: { must_not: [{ exists: { field: 'userHost' } }] } });
				} else {
					esFilter.bool.must.push({ term: { userHost: opts.host } });
				}
			}

			const searchQuery = this.buildOptimizedESQuery(q);

			const res = await this.elasticsearch.search({
				index: searchIndex,
				query: { bool: { must: [searchQuery, esFilter] } },
				sort: [{ createdAt: { order: 'desc' } }],
				_source: ['id', 'createdAt'],
				size: pagination.limit,
				highlight: {
					fields: {
						text: { pre_tags: ['<mark>'], post_tags: ['</mark>'], fragment_size: 100, number_of_fragments: 1 },
						cw: { pre_tags: ['<mark>'], post_tags: ['</mark>'], fragment_size: 50, number_of_fragments: 1 },
					},
				},
				min_score: 0.01,
			});

			const noteIds = res.hits.hits.map((hit: any) => hit._id);
			if (noteIds.length === 0) return [];

			const [userIdsWhoMeMuting, userIdsWhoBlockingMe] = me ? await Promise.all([
				this.cacheService.userMutingsCache.fetch(me.id),
				this.cacheService.userBlockedCache.fetch(me.id),
			]) : [new Set<string>(), new Set<string>()];

			const query = this.notesRepository.createQueryBuilder('note')
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			query.where('note.id IN (:...noteIds)', { noteIds });

			this.queryService.generateSoftDeletedNoteQuery(query);
			this.queryService.generateBlockedHostQueryForNote(query);
			this.queryService.generateSuspendedUserQueryForNote(query);

			const notes = (await query.getMany()).filter(note => {
				if (me && isUserRelated(note, userIdsWhoBlockingMe)) return false;
				return !(me && isUserRelated(note, userIdsWhoMeMuting));
			});

			const scoreMap = new Map();
			res.hits.hits.forEach((hit: any, index: number) => {
				scoreMap.set(hit._id, { score: hit._score, index, createdAt: hit._source?.createdAt || 0 });
			});

			return notes.sort((a, b) => {
				const aInfo = scoreMap.get(a.id);
				const bInfo = scoreMap.get(b.id);
				const aScore = aInfo?.score || 0;
				const bScore = bInfo?.score || 0;

				if (Math.abs(aScore - bScore) > 0.001) {
					return bScore - aScore;
				}
				const aCreatedAt = aInfo?.createdAt || this.idService.parse(a.id).date.getTime();
				const bCreatedAt = bInfo?.createdAt || this.idService.parse(b.id).date.getTime();
				return bCreatedAt - aCreatedAt;
			});
		} else {
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), pagination.sinceId, pagination.untilId);

			if (opts.userId) {
				query.andWhere('note.userId = :userId', { userId: opts.userId });
			} else if (opts.channelId) {
				query.andWhere('note.channelId = :channelId', { channelId: opts.channelId });
			}

			query
				.andWhere('LOWER(note.text) LIKE :q', { q: `%${ sqlLikeEscape(q.toLowerCase()) }%` })
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			if (opts.host) {
				if (opts.host === '.') {
					query.andWhere('user.host IS NULL');
				} else {
					query.andWhere('user.host = :host', { host: opts.host });
				}
			}

			this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateSoftDeletedNoteQuery(query);
			if (me) this.queryService.generateMutedUserQueryForNotes(query, me);
			if (me) this.queryService.generateBlockedUserQueryForNotes(query, me);

			return await query.limit(pagination.limit).getMany();
		}
	}
}
