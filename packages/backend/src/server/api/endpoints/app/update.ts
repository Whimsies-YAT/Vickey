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
	tags: ['app'],

	requireCredential: true,
	kind: 'write:account',

	errors: {
		noSuchApp: {
			message: 'No such app.',
			code: 'NO_SUCH_APP',
			id: 'dce83913-2dc6-4093-8a7b-71dbb9043fa3'
		}
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'App',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		appId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string' },
		description: { type: 'string' },
		callbackUrl: { type: 'string', nullable: true },
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
			});

			if (app == null) {
				throw new ApiError(meta.errors.noSuchApp);
			}

			await this.appsRepository.update(app.id, {
				name: ps.name,
				description: ps.description,
				callbackUrl: ps.callbackUrl,
			});

			const updated = await this.appsRepository.findOneByOrFail({ id: ps.appId });

			return await this.appEntityService.pack(updated, me, {
				detail: true,
				includeSecret: true,
			});
		});
	}
}
