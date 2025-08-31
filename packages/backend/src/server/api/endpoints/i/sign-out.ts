/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import { IsNull, Not } from 'typeorm';
import { isNativeUserToken } from '@/misc/token.js';

export const meta = {
	requireCredential: true,
	secure: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userSessionsService: UserSessionsService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers, rawToken) => {
			if (!rawToken) return { success: false };
			if (isNativeUserToken(rawToken)) {
				const freshUser = await this.usersRepository.findOneBy({ id: me.id });
				if (freshUser?.token) {
					await this.usersRepository.update(
						{ id: me.id, token: Not(IsNull()) },
						{ token: null }
					);
				}
				return {
					success: true,
				};
			}
			const isNew = await this.userSessionsService.validateToken(rawToken, me.id, ip);

			if (isNew) {
				await this.userSessionsService.invalidateTokenSafely(me.id, rawToken);
				return {
					success: true,
				};
			}

			return {
				success: false,
			};
		});
	}
}
