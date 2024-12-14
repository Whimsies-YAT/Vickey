/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository, UserProfilesRepository } from '@/models/_.js';
import { EmailService } from '@/core/EmailService.js';
import { UserSuspendService } from '@/core/UserSuspendService.js';
import { DI } from '@/di-symbols.js';
import {RoleService} from "@/core/RoleService.js";

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:unsuspend-user',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private emailService: EmailService,
		private userSuspendService: UserSuspendService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.usersRepository.findOneBy({ id: ps.userId });
			const userProfile = await this.userProfilesRepository.findOneBy({ userId: ps.userId });

			if (user == null) {
				throw new Error('user not found');
			}

			await this.userSuspendService.unsuspend(user, me);
			if (userProfile?.email && userProfile.emailVerified) {
				await this.emailService.sendEmail(userProfile.email, 'Account Reinstated',
					'Your account has been reinstated. You can now access it again. If you have any further questions, please contact moderators.',
					'Your account has been reinstated. You can now access it again. If you have any further questions, please contact moderators.');
			}
		});
	}
}
