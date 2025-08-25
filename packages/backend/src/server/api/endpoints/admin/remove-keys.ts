/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository, UserSecurityKeysRepository, UsersRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import {MiLocalUser} from "@/models/User.js";
import { IsNull } from "typeorm";

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:reset-password',

	secure: true,

	errors: {
		userNotFound: {
			message: 'User not found.',
			code: 'USER_NOT_FOUND',
			id: '91f2fc98-814a-11f0-8757-b025aa6cce5f',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userSecurityKeysRepository)
		private userSecurityKeysRepository: UserSecurityKeysRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userEntityService: UserEntityService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps) => {
			let profile: MiLocalUser;
			try {
				const user = await this.usersRepository.findOneByOrFail({
					id: ps.userId,
					host: IsNull(),
					uri: IsNull(),
				});
				profile = user as MiLocalUser;
			} catch (e) {
				throw new ApiError(meta.errors.userNotFound);
			}

			// Make sure we only delete the user's own creds
			await this.userSecurityKeysRepository.delete({
				userId: ps.userId,
			});

			// 使われているキーがなくなったらパスワードレスログインをやめる
			const keyCount = await this.userSecurityKeysRepository.count({
				where: {
					userId: ps.userId,
				},
				select: {
					id: true,
					name: true,
					lastUsed: true,
				},
			});

			if (keyCount === 0) {
				await this.userProfilesRepository.update(ps.userId, {
					usePasswordLessLogin: false,
				});
			}

			// Publish meUpdated event
			this.globalEventService.publishMainStream(ps.userId, 'meUpdated', await this.userEntityService.pack(ps.userId, profile, {
				schema: 'MeDetailed',
				includeSecrets: true,
			}));

			return {};
		});
	}
}
