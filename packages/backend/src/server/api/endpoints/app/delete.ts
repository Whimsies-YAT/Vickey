/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AppsRepository, AccessTokensRepository } from '@/models/_.js';
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
	}
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		appId: { type: 'string', format: 'misskey:id' },
	},
	required: ['appId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const app = await this.appsRepository.findOneBy({
				id: ps.appId,
				userId: me.id,
			});

			if (app == null) {
				throw new ApiError(meta.errors.noSuchApp);
			}

			await this.accessTokensRepository.delete({
				appId: ps.appId,
			});

			await this.appsRepository.delete(ps.appId);
		});
	}
}
