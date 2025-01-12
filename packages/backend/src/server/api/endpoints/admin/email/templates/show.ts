/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';
import { ApiError } from '../../../../error.js';
import { MiEmailTemplates } from "@/models/EmailTemplates.js";

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'read:admin:email-templates',

	errors: {
		noSuchKey: {
			message: 'No such key.',
			code: 'NO_SUCH_KEY',
			id: '941dabe4-cb10-11ef-acb0-6f64164b30bb',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		key: { type: 'string', nullable: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private emailTemplatesService: EmailTemplatesService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!ps.key) {
				const templates: MiEmailTemplates[] = await this.emailTemplatesService.showAllTemplates();
				if (!templates) {
					throw new ApiError(meta.errors.noSuchKey);
				}
				return templates;
			} else {
				const templates: boolean | MiEmailTemplates = await this.emailTemplatesService.showTemplates(ps.key);
				if (!templates) {
					throw new ApiError(meta.errors.noSuchKey);
				}
				return templates;
			}
		});
	}
}

