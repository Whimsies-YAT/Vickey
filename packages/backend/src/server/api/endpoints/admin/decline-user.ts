/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from "@nestjs/common";
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserPendingsRepository, UsersRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:decline-account',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		reason: { type: 'string', nullable: true },
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

		private moderationLogService: ModerationLogService,
		private emailService: EmailService,
		private emailTemplatesService: EmailTemplatesService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const pendingUser = await this.userPendingsRepository.findOneByOrFail({ id: ps.userId });

			const user = await this.usersRepository.findOneBy({ id: ps.userId });

			if (pendingUser == null || user?.isDeleted) {
				throw new Error('user not found or already deleted');
			}

			if (user?.approved) {
				throw new Error('user is already approved');
			}

			if (user?.host) {
				throw new Error('user is not local');
			}

			const reason = ps.reason?.trim();

			if (pendingUser.email && pendingUser.emailVerified) {
				if (!reason) {
					const result = await this.emailTemplatesService.sendEmailWithTemplates(pendingUser.email, 'accountDeclined');
					if (!result) {
						await this.emailService.sendEmail(pendingUser.email, 'Account declined',
							'Your Account has been declined!',
							'Your Account has been declined!');
					}
				} else {
					const result = await this.emailTemplatesService.sendEmailWithTemplates(pendingUser.email, 'accountDeclinedWithReason', { reason });
					if (!result) {
						await this.emailService.sendEmail(pendingUser.email, 'Account declined',
							`Your account has been declined due to: ${reason}`,
							`Your account has been declined due to: ${reason}`);
					}
				}
			}

			const log_reason = reason ? reason : 'Reason not provided';

			this.userPendingsRepository.delete({
				id: pendingUser.id,
			});

			this.moderationLogService.log(me, 'decline', {
				userId: pendingUser.id,
				userUsername: pendingUser.username,
				userHost: null,
				reason: log_reason,
			});
		});
	}
}
