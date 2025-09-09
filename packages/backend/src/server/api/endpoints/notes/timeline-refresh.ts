/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SmartTimelineService } from '@/core/SmartTimelineService.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'write:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			success: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			message: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private smartTimelineService: SmartTimelineService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			await this.smartTimelineService.refreshTimelineCache(me.id);

			return {
				success: true,
				message: 'Timeline cache refreshed successfully',
			};
		});
	}
}
