/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
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
	private elasticsearchNoteIndex: string | null = null;

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

		if (!meilisearch && this.elasticsearch) {
			const indexName = `${config.elasticsearch!.index}---notes`;
			this.elasticsearchNoteIndex = indexName;

			this.elasticsearch.indices.exists({
				index: indexName,
			}).then((indexExists) => {
				if (!indexExists) {
					this.elasticsearch?.indices.create({
						index: indexName + `-${new Date().toISOString().slice(0, 7).replace(/-/g, '')}`,
						body: {
							mappings: {
								properties: {
									text: { type: 'text' },
									cw: { type: 'text' },
									createdAt: { type: 'long' },
									userId: { type: 'keyword' },
									userHost: { type: 'keyword' },
									channelId: { type: 'keyword' },
									tags: { type: 'keyword' },
								},
							},
							settings: {
								//TODO: Make settings for optimization.
							},
						},
					}).catch((error) => {
						console.error(error);
					});
				}
			}).catch((error) => {
				console.error(error);
			});
		} else {
			this.elasticsearchNoteIndex = null;
		}

		if (config.meilisearch?.scope) {
			this.meilisearchIndexScope = config.meilisearch.scope;
		}

		this.provider = config.fulltextSearch?.provider ?? 'sqlLike';
		this.loggerService.getLogger('SearchService').info(`-- Provider: ${this.provider}`);
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
			const body = {
				createdAt: this.idService.parse(note.id).date.getTime(),
				userId: note.userId,
				userHost: note.userHost,
				channelId: note.channelId,
				cw: note.cw,
				text: note.text,
				tags: note.tags,
			};

			await this.elasticsearch.index({
				index: this.elasticsearchNoteIndex + `-${new Date().toISOString().slice(0, 7).replace(/-/g, '')}` as string,
				id: note.id,
				body: body,
			});
		}
	}

	@bindThis
	public async unindexNote(note: MiNote): Promise<void> {
		if (!['home', 'public'].includes(note.visibility)) return;

		if (this.meilisearch) {
			await this.meilisearchNoteIndex!.deleteDocument(note.id);
		}

		if (!this.meilisearch && this.elasticsearch) {
			(this.elasticsearch.delete)({
				index: this.elasticsearchNoteIndex + `-${new Date().toISOString().slice(0, 7).replace(/-/g, '')}` as string,
				id: note.id,
			});
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
				query.andWhere('user.host IS NULL');
			} else {
				query.andWhere('user.host = :host', { host: opts.host });
			}
		}

		this.queryService.generateVisibilityQuery(query, me);
		if (me) this.queryService.generateMutedUserQuery(query, me);
		if (me) this.queryService.generateBlockedUserQuery(query, me);

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
			case 'meilisearch': { // save for compatibility
				return this.searchNoteBySearchEngine(q, me, opts, pagination);
			}
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
			const notes = (await this.notesRepository.findBy({
				id: In(res.hits.map(x => x.id)),
			})).filter(note => {
				if (me && isUserRelated(note, userIdsWhoBlockingMe)) return false;
				if (me && isUserRelated(note, userIdsWhoMeMuting)) return false;
				return true;
			});

			return notes.sort((a, b) => a.id > b.id ? -1 : 1);
		} else if (this.elasticsearch) {
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
			const res = await (this.elasticsearch.search)({
				index: this.elasticsearchNoteIndex + `*` as string,
				body: {
					query: {
						bool: {
							must: [
									{
									bool: {
										should: [
											{ wildcard: { "text": { value: `*${q}*` }, } },
											{ simple_query_string: { fields: ["text"], "query": q, default_operator: 'and', } },
										],
										minimum_should_match: 1,
									},
								},
								esFilter,
							]
						},
					},
				},
				sort: [{ createdAt: { order: "desc" } }],
				_source: ['id', 'createdAt'],
				size: pagination.limit,

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
			const notes = (await this.notesRepository.findBy({
				id: In(noteIds),
			})).filter(note => {
				if (me && isUserRelated(note, userIdsWhoBlockingMe)) return false;
				if (me && isUserRelated(note, userIdsWhoMeMuting)) return false;
				return true;
			});
			return notes.sort((a, b) => a.id > b.id ? -1 : 1);
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
			if (me) this.queryService.generateMutedUserQuery(query, me);
			if (me) this.queryService.generateBlockedUserQuery(query, me);

			return await query.limit(pagination.limit).getMany();
		}
	}
}
