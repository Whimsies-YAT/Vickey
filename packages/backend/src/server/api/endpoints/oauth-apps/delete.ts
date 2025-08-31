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
	tags: ['oauth-apps'],

	requireCredential: true,
	kind: 'write:account',

	errors: {
		noSuchApp: {
			message: 'No such OAuth app.',
			code: 'NO_SUCH_OAUTH_APP',
			id: 'dce83915-2dc6-4093-8a7b-71dbb9043fa5'
		}
	}
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		appId: { type: 'string' },
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
				isOAuth: true,
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
