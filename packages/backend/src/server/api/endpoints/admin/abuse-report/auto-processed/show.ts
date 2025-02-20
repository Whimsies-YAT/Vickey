/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import type { AbuseNoteAutoCheckRepository, MiAbuseNoteAutoCheck } from '@/models/_.js'

export const meta = {
	tags: ['admin', 'abuse-report', 'auto-processed'],

	requireCredential: true,
	requireModerator: true,
	secure: true,
	kind: 'read:admin:abuse-report:auto-processed',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limitObj: { type: "object" },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.abuseNoteAutoCheckRepository)
		private abuseNoteAutoCheckRepository: AbuseNoteAutoCheckRepository,

		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps) => {
			const query = this.queryService.makePaginationQuery(this.abuseNoteAutoCheckRepository.createQueryBuilder('abuse_note_autocheck'), ps.limitObj ?? '');
			const reports = await query.limit(ps.limit).getMany();

			const reads = new Map<MiAbuseNoteAutoCheck, number>();
			for (const report of reports) {
				reads.set(report, await this.abuseNoteAutoCheckRepository.countBy({
					id: report.id,
				}));
			}

			return reports.map(report => ({
				id: report.id,
				detail: report.detail,
				score: report.score,
				ignore: report.ignore,
			}));
		});
	}
}
