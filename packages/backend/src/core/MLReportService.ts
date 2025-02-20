/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MiAbuseNoteAutoCheck, AbuseNoteAutoCheckRepository, AbuseUserReportsRepository, UsersRepository, NotesRepository, MiMeta, MiUser } from '@/models/_.js';
import { CacheService } from '@/core/CacheService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { NoteDeleteService } from '@/core/NoteDeleteService.js';
import { bindThis } from '@/decorators.js';
import { DI } from "@/di-symbols.js";
import * as console from "node:console";
import { IdService } from './IdService.js';

@Injectable()
export class MLReportService {
	constructor(

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.abuseUserReportsRepository)
		private abuseUserReportsRepository: AbuseUserReportsRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.abuseNoteAutoCheckRepository)
		private abuseNoteAutoCheckRepository: AbuseNoteAutoCheckRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private cacheService: CacheService,
		private noteDeleteService: NoteDeleteService,
		private httpRequestService: HttpRequestService,
	) {}

	@bindThis
	public async MLCheck(model: string, id?: string): Promise<void> {
		switch (model) {
			case 'abuseCheck':
				if (id) {
					return await this.AbuseReport(id);
				}
		}
		console.warn("Invalid model, ignored");
	}

	@bindThis
	public async AbuseReport(id: string): Promise<void> {
		if (id && this.meta.abuseMLCheck && this.meta.abuseMLInfoUrl && this.meta.abuseMLInfoToken) {
			try {
				const note = await this.notesRepository.findOneByOrFail({ id });
				const text = note.text || '';
				const res = await this.httpRequestService.send(this.meta.abuseMLInfoUrl, {
					method: 'POST',
					headers: {
						'Accept': 'application/json',
						'Authorization': `Bearer ${ this.meta.abuseMLInfoToken }`,
					},
					body: JSON.stringify({
						note: text,
					}),
					timeout: 180000,
				});
				if (res.ok) {
					const result = await res.json() as { label: string; score: number };
					// eslint-disable-next-line prefer-const -- Must be let
					let { label, score } = result;
					if (label === "spam") score = 1 - score;
					let ignore: boolean = false;
					let status: number = 0;
					if (score < this.meta.abuseMLInfoScore) {
						const actionMap: Record<string, { ignore: boolean, status: number }> = {
							'record': { ignore: false, status: 0 },
							'ignore': { ignore: true, status: 1 },
							'delete': { ignore: false, status: 2 }
						};

						const action = actionMap[this.meta.abuseReportMLAction];
						if (action) {
							ignore = action.ignore;
							status = action.status;
						}
					}

					if (status === 2) {
						try {
							const uid = await this.usersRepository.findOneBy({ isRoot: true });
							const virtualUser = {
								id: uid ? uid.id : "0",
								uri: null,
								host: null,
								isBot: uid ? uid.isBot : true,
							} as MiUser;
							await this.noteDeleteService.delete(virtualUser, note, false);
						} catch (err) {
							console.error(err);
						}
					}

					const data = {
						id: this.idService.gen(),
						detail: {
							id,
							note,
							label,
							status,
							resolved: false,
						},
						score,
						ignore,
					} as MiAbuseNoteAutoCheck;

					await Promise.all([this.abuseUserReportsRepository.update({ targetId: id, type: "note" }, { status }), this.abuseNoteAutoCheckRepository.insertOne(data)]);

					const resolve = await this.abuseUserReportsRepository.findOneBy({ targetId: id });
					if (!resolve || !resolve.resolved) {
						await this.cacheService.abuseAutoIgnoreCache.refresh('abuseAutoIgnore');
					}
				} else {
					console.error(`Failed with ${res.body}`);
				}
			} catch (e: unknown) {
				if (e instanceof Error) {
					console.error(e);
					return;
				} else {
					throw new Error('An unknown error occurred.');
				}
			}
		}
	}
}
