/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { EmailTemplatesRepository } from '@/models/_.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:email-templates',

	errors: {
		emptyContent: {
			message: 'Empty content.',
			code: 'EMPTY_CONTENT',
			id: '9a52fa28-cb10-11ef-b423-0789f850e673',
		},

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
		templates: {
			type: 'array',
			nullable: false,
			items: {
				type: 'object',
				nullable: false,
				properties: {
					key: {
						type: 'string',
						nullable: false,
					},
					content: {
						type: 'array',
						nullable: false,
						items: {
							type: 'string',
						},
					},
					enabled: {
						type: 'boolean',
						nullable: false,
					},
				},
				required: ['key', 'content', 'enabled'],
			},
		},
	},
	required: ['templates'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emailTemplatesRepository)
		private emailTemplatesRepository: EmailTemplatesRepository,

		private emailTemplatesService: EmailTemplatesService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.templates) {
				for (const template of ps.templates) {
					const { key, content, enabled } = template;
					const templateDB = await this.emailTemplatesRepository.findOneBy({ key: key });
					if (!templateDB) continue;

					let [sub, msg] = content;

					if (!sub.trim() && !msg.trim()) {
						throw new ApiError(meta.errors.emptyContent);
					}

					sub = sub.trim() ? sub : templateDB.content[0];
					msg = msg.trim() ? msg : templateDB.content[1];

					const success = await this.emailTemplatesService.customEmailTemplates(key, sub, msg, enabled);
					if (!success) throw new ApiError(meta.errors.noSuchKey);
				}
			}
		});
	}
}

