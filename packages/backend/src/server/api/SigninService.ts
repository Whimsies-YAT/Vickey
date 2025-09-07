/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { SigninsRepository, UserProfilesRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/User.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { bindThis } from '@/decorators.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { MultiAccountDetectionService } from '@/core/MultiAccountDetectionService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { detectDeviceType } from '@/misc/device-type.js';
import { RiskEventLogService } from '@/core/RiskEventLogService.js';

@Injectable()
export class SigninService {
	constructor(
		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private signinEntityService: SigninEntityService,
		private emailService: EmailService,
		private emailTemplatesService: EmailTemplatesService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private userSessionsService: UserSessionsService,
		private userRiskScoreService: UserRiskScoreService,
		private multiAccountDetectionService: MultiAccountDetectionService,
		private riskEventLogService: RiskEventLogService,
	) {
	}

	@bindThis
	public async signin(request: FastifyRequest, reply: FastifyReply, user: MiLocalUser) {
		const id = this.idService.gen();
		const deviceInfo = detectDeviceType(request.headers);
		const sessionToken = await this.userSessionsService.createTokenSafely({
			userId: user.id,
			signInId: id,
			deviceInfo,
		});

		if (!sessionToken) {
			reply.code(500);
			return {
				error: {
					message: 'Failed to create session token',
					code: 'SESSION_TOKEN_CREATION_FAILED',
					id: 'f5d7e8c9-1a2b-3c4d-5e6f-708192a3b4c5',
				},
			};
		}

		setImmediate(async () => {
			this.notificationService.createNotification(user.id, 'login', {});

			const record = await this.signinsRepository.insertOne({
				id,
				userId: user.id,
				ip: request.ip,
				headers: request.headers as any,
				success: true,
			});

			// @ts-expect-error: The incoming IP must be a string.
			this.globalEventService.publishMainStream(user.id, 'signin', await this.signinEntityService.pack(record));

			const riskScorePromise = this.userRiskScoreService.calculateUserRiskScore(user.id).catch((err: Error) => {
				console.error(`Failed to calculate risk score for user ${user.id}:`, err);
				return null;
			});

			// Track the signin request for multi-account detection
			const trackingPromise = this.multiAccountDetectionService.trackRequest(user.id, request, 'signin').catch((err: Error) => {
				console.error(`Failed to track request for user ${user.id}:`, err);
			});

			const [riskScore] = await Promise.all([riskScorePromise, trackingPromise]);

			if (riskScore) {
				// Log all signin events to database for monitoring
				await this.riskEventLogService.logRiskEvent({
					userId: user.id,
					eventType: 'user_login',
					riskScore: riskScore.totalScore,
					riskLevel: riskScore.riskLevel,
					details: {
						ip: request.ip,
						userAgent: request.headers['user-agent'] || '',
						dimensions: riskScore.dimensions,
					},
					timestamp: new Date(),
				});
			}


			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
			if (profile.email && profile.emailVerified) {
				const result = await this.emailTemplatesService.sendEmailWithTemplates(profile.email, 'newLogin');
				if (!result) {
					this.emailService.sendEmail(profile.email, 'New login / ログインがありました',
						'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。',
						'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。');
				}
			}
		});

		reply.code(200);
		return {
			finished: true,
			id: user.id,
			i: sessionToken,
		};
	}
}
