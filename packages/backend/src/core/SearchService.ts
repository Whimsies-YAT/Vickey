/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { type Config, FulltextSearchProvider } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { MiNote } from '@/models/Note.js';
import type { NotesRepository } from '@/models/_.js';
import { MiUser } from '@/models/_.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { CacheService } from '@/core/CacheService.js';
import { QueryService } from '@/core/QueryService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { Client as ElasticSearch } from '@elastic/elasticsearch';
import type { Index, MeiliSearch } from 'meilisearch';

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
	} else if (typeof value === 'boolean') {
		return value.toString();
	}
	throw new Error('unrecognized value');
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

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meilisearch)
		private meilisearch: MeiliSearch | null,

		@Inject(DI.elasticsearch)
		private elasticsearch: ElasticSearch | null,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private cacheService: CacheService,
		private queryService: QueryService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
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
			const base = `${config.elasticsearch!.index}---notes`;
			const month = new Date().toISOString().slice(0, 7).replace(/-/g, '');
			const prefix = `${base}-${month}`;
			const MAX_DOCS = 5_000_000;

			(async () => {
				let i = 0;
				while (true) {
					const idx = i === 0 ? prefix : `${prefix}-${i}`;
					const exists = await this.elasticsearch!.indices.exists({ index: idx });
					if (!exists) {
						await this.elasticsearch!.indices.create({
							index: idx,
							mappings: {
								properties: {
									text: {
										type: 'text',
										analyzer: 'optimized_analyzer',
										search_analyzer: 'optimized_search_analyzer',
										fields: {
											keyword: {
												type: 'keyword'
											},
											exact: {
												type: 'text',
												analyzer: 'keyword'
											}
										}
									},
									cw: {
										type: 'text',
										analyzer: 'optimized_analyzer',
										search_analyzer: 'optimized_search_analyzer'
									},
									createdAt: { type: 'long' },
									userId: { type: 'keyword' },
									userHost: { type: 'keyword' },
									channelId: { type: 'keyword' },
									tags: { type: 'keyword' },
								},
							},
							settings: {
								analysis: {
									analyzer: {
										optimized_analyzer: {
											type: 'custom',
											tokenizer: 'ik_max_word',
											filter: [
												'lowercase',
												'word_delimiter',
												'stop',
												'trim'
											]
										},
										optimized_search_analyzer: {
											type: 'custom',
											tokenizer: 'ik_smart',
											filter: [
												'lowercase',
												'word_delimiter',
												'stop',
												'trim'
											]
										}
									},
									tokenizer: {
										custom_tokenizer: {
											type: 'pattern',
											pattern: '[\\s\\p{P}]+',
											flags: 'CASE_INSENSITIVE'
										}
									}
								},
								number_of_shards: 1,
								number_of_replicas: 0,
								refresh_interval: '30s',
								max_result_window: 50000,
								similarity: {
									default: {
										type: 'BM25',
										k1: 1.5,
										b: 0.75
									}
								}
							},
						});
						this.elasticsearchWriteIndex = idx;
						break;
					}

					const { count } = await this.elasticsearch!.count({ index: idx });
					if (count < MAX_DOCS) {
						this.elasticsearchWriteIndex = idx;
						break;
					}

					i++;
				}

				this.elasticsearchSearchIndex = `${base}*`;
			})().catch(err => {
				console.error('Elasticsearch index initialization exception:', err);
				this.elasticsearchWriteIndex = prefix;
				this.elasticsearchSearchIndex = `${base}*`;
			});
		}

		if (config.meilisearch?.scope) {
			this.meilisearchIndexScope = config.meilisearch.scope;
		}

		this.provider = config.fulltextSearch?.provider ?? 'sqlLike';
		this.loggerService.getLogger('SearchService').info(`-- Provider: ${this.provider === 'searchengine' ? 'Search Engine' : this.provider}`);
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
						_id: note.id
					}
				}
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
						{
							match_phrase: {
								text: {
									query: phrase,
									boost: 10
								}
							}
						},
						{
							match_phrase: {
								cw: {
									query: phrase,
									boost: 8
								}
							}
						}
					],
					minimum_should_match: 1
				}
			};
		} else {
			return {
				bool: {
					should: [
						{
							term: {
								'text.keyword': {
									value: cleanQuery,
									boost: 15
								}
							}
						},
						{
							match_phrase: {
								text: {
									query: cleanQuery,
									boost: 12
								}
							}
						},
						{
							match_phrase: {
								cw: {
									query: cleanQuery,
									boost: 10
								}
							}
						},
						{
							match: {
								text: {
									query: cleanQuery,
									operator: 'and',
									boost: 8
								}
							}
						},
						{
							match: {
								cw: {
									query: cleanQuery,
									operator: 'and',
									boost: 6
								}
							}
						},
						{
							match: {
								text: {
									query: cleanQuery,
									operator: 'or',
									boost: 4,
									minimum_should_match: '50%'
								}
							}
						},
						{
							match: {
								cw: {
									query: cleanQuery,
									operator: 'or',
									boost: 3,
									minimum_should_match: '50%'
								}
							}
						},
						{
							multi_match: {
								query: cleanQuery,
								fields: ['text^2', 'cw^1.5'],
								type: 'best_fields',
								boost: 2,
								fuzziness: 'AUTO',
								minimum_should_match: '30%'
							}
						},
						{
							fuzzy: {
								text: {
									value: cleanQuery,
									fuzziness: 'AUTO',
									boost: 1,
									max_expansions: 10
								}
							}
						}
					],
					minimum_should_match: 1
				}
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
			case 'sqlPgroonga': {
				// ほとんど内容に差がないのでsqlLikeとsqlPgroongaを同じ処理にしている.
				// 今後の拡張で差が出る用であれば関数を分ける.
				return this.searchNoteByLike(q, me, opts, pagination);
			}
			case 'meilisearch': // save for compatibility
			case "SearchEngine":
			case "searchEngine":
			case 'searchengine': {
				return this.searchNoteBySearchEngine(q, me, opts, pagination);
			}
			default: {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const typeCheck: never = this.provider;
				return [];
			}
		}
	}

	@bindThis
	public async searchNoteBySearchEngine(q: string, me: MiUser | null, opts: {
		userId?: MiNote['userId'] | null;
		channelId?: MiNote['channelId'] | null;
		host?: string | null;
	}, pagination: {
		untilId?: MiNote['id'];
		sinceId?: MiNote['id'];
		limit?: number;
	}): Promise<MiNote[]> {
		if (this.meilisearch) {
			if (!this.meilisearchNoteIndex) {
				throw new Error('MeiliSearch is not available');
			}

			const filter: Q = {
				op: 'and',
				qs: [],
			};
			if (pagination.untilId) filter.qs.push({
				op: '<',
				k: 'createdAt',
				v: this.idService.parse(pagination.untilId).date.getTime(),
			});
			if (pagination.sinceId) filter.qs.push({
				op: '>',
				k: 'createdAt',
				v: this.idService.parse(pagination.sinceId).date.getTime(),
			});
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
			if (res.hits.length === 0) {
				return [];
			}

			const [
				userIdsWhoMeMuting,
				userIdsWhoBlockingMe,
			] = me
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
			const esFilter: any = {
				bool: {
					must: [],
				},
			};
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
				index: this.elasticsearchSearchIndex,
				query: {
					bool: {
						must: [
							searchQuery,
							esFilter
						]
					}
				},
				sort: [
					// { _score: { order: "desc" } },
					{ createdAt: { order: "desc" } }
				],
				_source: ['id', 'createdAt'],
				size: pagination.limit,
				highlight: {
					fields: {
						text: {
							pre_tags: ["<mark>"],
							post_tags: ["</mark>"],
							fragment_size: 100,
							number_of_fragments: 1
						},
						cw: {
							pre_tags: ["<mark>"],
							post_tags: ["</mark>"],
							fragment_size: 50,
							number_of_fragments: 1
						}
					}
				},
				min_score: 0.01
			});

			const noteIds = res.hits.hits.map((hit: any) => hit._id);
			if (noteIds.length === 0) return [];

			const [
				userIdsWhoMeMuting,
				userIdsWhoBlockingMe,
			] = me ? await Promise.all([
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
