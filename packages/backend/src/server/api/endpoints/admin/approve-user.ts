/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserPendingsRepository, UserProfilesRepository, UsersRepository, RegistrationTicketsRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { SignupService } from '@/core/SignupService.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:approve-user',
	secure: true,
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

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private signupService: SignupService,
		private moderationLogService: ModerationLogService,
		private emailService: EmailService,
		private emailTemplatesService: EmailTemplatesService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			const pendingUser = await this.userPendingsRepository.findOneByOrFail({ id: ps.userId, isProcessed: false });

			const { account, secret } = await this.signupService.signup({
				username: pendingUser.username,
				passwordHash: pendingUser.password,
				reason: pendingUser.reason,
				approved: true,
				ip: ip || '127.0.0.1',
				headers,
			});

			const user = await this.usersRepository.findOneByOrFail({ id: account.id });

			if (user == null) {
				throw new Error('user not found');
			}

			const profile = await this.userProfilesRepository.findOneBy({ userId: account.id });
			if (pendingUser.email && pendingUser.emailVerified) {
				this.userProfilesRepository.update({ userId: profile?.userId }, {
					email: pendingUser.email,
					emailVerified: true,
					emailVerifyCode: null,
				});
			}

			if (pendingUser.email && pendingUser.emailVerified) {
				const result = await this.emailTemplatesService.sendEmailWithTemplates(pendingUser.email, 'accountApproved');
				if (!result) {
					this.emailService.sendEmail(pendingUser.email, 'Account Approved',
						'Your Account has been approved. Have fun socializing!',
						'Your Account has been approved. Have fun socializing!');
				}
			}

			this.userPendingsRepository.update({ id: pendingUser.id }, { isProcessed: true, result: "Approved" });

			const inviteCode = await this.registrationTicketsRepository.findOneBy({ pendingUserId: pendingUser.id });
			if (inviteCode) {
				await this.registrationTicketsRepository.update({ id: inviteCode.id }, {
					usedBy: user,
					usedById: user.id,
					pendingUserId: null,
				});
			}

			this.moderationLogService.log(me, 'approve', {
				userId: user.id,
				userUsername: user.username,
				userHost: user.host,
			});
		});
	}
}
