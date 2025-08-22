/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AppsRepository } from '@/models/_.js';
import { AppEntityService } from '@/core/entities/AppEntityService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['oauth-apps'],

	requireCredential: true,
	kind: 'write:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'App',
	},

	errors: {
		noSuchApp: {
			message: 'No such OAuth app.',
			code: 'NO_SUCH_OAUTH_APP',
			id: 'dce83914-2dc6-4093-8a7b-71dbb9043fa4'
		}
	}
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		appId: { type: 'string' },
		name: { type: 'string', maxLength: 128 },
		description: { type: 'string', maxLength: 512 },
		callbackUrl: { type: 'string', nullable: true, maxLength: 512 },
		iconUrl: { type: 'string', nullable: true, maxLength: 512 },
		websiteUrl: { type: 'string', nullable: true, maxLength: 512 },
	},
	required: ['appId', 'name', 'description'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		private appEntityService: AppEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const app = await this.appsRepository.findOneBy({
				id: ps.appId,
				userId: me.id,
				isOAuth: true,
			});

			if (app == null) {
				throw new ApiError(meta.errors.noSuchApp);
			}

			await this.appsRepository.update(app.id, {
				name: ps.name,
				description: ps.description,
				callbackUrl: ps.callbackUrl,
				iconUrl: ps.iconUrl,
				websiteUrl: ps.websiteUrl,
			});

			return await this.appEntityService.pack(ps.appId, me, {
				detail: true,
				includeSecret: true,
			});
		});
	}
}