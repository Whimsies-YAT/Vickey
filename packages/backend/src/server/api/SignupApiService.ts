/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { RegistrationTicketsRepository, UsedUsernamesRepository, UserPendingsRepository, UserProfilesRepository, UsersRepository, MiRegistrationTicket, MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { IdService } from '@/core/IdService.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { IP2LocationService } from '@/core/IP2LocationService.js';
import { MiLocalUser } from '@/models/User.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { bindThis } from '@/decorators.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { SigninService } from './SigninService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { RoleService } from '@/core/RoleService.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';

@Injectable()
export class SignupApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private captchaService: CaptchaService,
		private signupService: SignupService,
		private signinService: SigninService,
		private emailService: EmailService,
		private roleService: RoleService,
		private iP2LocationService: IP2LocationService,
		private emailTemplatesService: EmailTemplatesService,
	) {
	}

	@bindThis
	public async signup(
		request: FastifyRequest<{
			Body: {
				username: string;
				password: string;
				host?: string;
				invitationCode?: string;
				emailAddress?: string;
				reason?: string;
				'hcaptcha-response'?: string;
				'g-recaptcha-response'?: string;
				'turnstile-response'?: string;
				'm-captcha-response'?: string;
				'testcaptcha-response'?: string;
			}
		}>,
		reply: FastifyReply,
	) {
		const ip = request.ip;
		const body = request.body;

		// Verify *Captcha
		// ただしテスト時はこの機構は障害となるため無効にする
		if (process.env.NODE_ENV !== 'test') {
			if (ip && !await this.iP2LocationService.checkIP(ip)) {
				reply.code(400);
				reply.code(403);
				return {
					error: {
						message: 'Access is Actively Denied',
						code: 'ACCESS_DENIED',
						id: '1ac836e0-c8b5-11ef-bed9-7724be24f9c5',
					},
				};
			}

			if (this.meta.enableHcaptcha && this.meta.hcaptchaSecretKey) {
				await this.captchaService.verifyHcaptcha(this.meta.hcaptchaSecretKey, body['hcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableMcaptcha && this.meta.mcaptchaSecretKey && this.meta.mcaptchaSitekey && this.meta.mcaptchaInstanceUrl) {
				await this.captchaService.verifyMcaptcha(this.meta.mcaptchaSecretKey, this.meta.mcaptchaSitekey, this.meta.mcaptchaInstanceUrl, body['m-captcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableRecaptcha && this.meta.recaptchaSecretKey) {
				await this.captchaService.verifyRecaptcha(this.meta.recaptchaSecretKey, body['g-recaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTurnstile && this.meta.turnstileSecretKey) {
				await this.captchaService.verifyTurnstile(this.meta.turnstileSecretKey, body['turnstile-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTestcaptcha) {
				await this.captchaService.verifyTestcaptcha(body['testcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}
		}

		const username = body['username'];
		const password = body['password'];
		const host: string | null = process.env.NODE_ENV === 'test' ? (body['host'] ?? null) : null;
		const invitationCode = body['invitationCode'];
		const reason = body['reason'];
		const emailAddress = body['emailAddress'];

		if (this.meta.emailRequiredForSignup) {
			if (emailAddress == null || typeof emailAddress !== 'string') {
				reply.code(400);
				return;
			}

			const res = await this.emailService.validateEmailForAccount(emailAddress);
			if (!res.available) {
				reply.code(400);
				return;
			}
		}

		if (this.meta.approvalRequiredForSignup) {
			if (reason == null || typeof reason !== 'string') {
				reply.code(400);
				return;
			}
		}

		let ticket: MiRegistrationTicket | null = null;

		if (this.meta.disableRegistration) {
			if (invitationCode == null || typeof invitationCode !== 'string') {
				reply.code(400);
				return;
			}

			ticket = await this.registrationTicketsRepository.findOneBy({
				code: invitationCode,
			});

			if (ticket == null || ticket.usedById != null) {
				reply.code(400);
				return;
			}

			if (ticket.expiresAt && ticket.expiresAt < new Date()) {
				reply.code(400);
				return;
			}

			// メアド認証が有効の場合
			if (this.meta.emailRequiredForSignup) {
				// メアド認証済みならエラー
				if (ticket.usedBy) {
					reply.code(400);
					return;
				}

				// 認証しておらず、メール送信から30分以内ならエラー
				if (ticket.usedAt && ticket.usedAt.getTime() + (1000 * 60 * 30) > Date.now()) {
					reply.code(400);
					return;
				}
			} else if (ticket.usedAt) {
				reply.code(400);
				return;
			}
		}

		if (await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
			throw new FastifyReplyError(400, 'DUPLICATED_USERNAME');
		}

		if (await this.userPendingsRepository.exists({ where: { username: username.toLowerCase() } })) {
			throw new FastifyReplyError(400, 'TEMP_DUPLICATED_USERNAME');
		}

		// Check deleted username duplication
		if (await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
			throw new FastifyReplyError(400, 'USED_USERNAME');
		}

		const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
		if (isPreserved) {
			throw new FastifyReplyError(400, 'DENIED_USERNAME');
		}

		const code = secureRndstr(16, { chars: L_CHARS });

		// Generate hash of password
		const salt = await bcrypt.genSalt(8);
		const hash = await bcrypt.hash(password, salt);

		const pendingUser = await this.userPendingsRepository.insertOne({
			id: this.idService.gen(),
			code,
			email: emailAddress,
			username: username,
			password: hash,
			reason: reason,
		});

		if (this.meta.emailRequiredForSignup && pendingUser.email) {
			const link = `${this.config.url}/signup-complete/${code}`;

			const result = await this.emailTemplatesService.sendEmailWithTemplates(emailAddress!, 'signup', { link });
			if (!result) {
				this.emailService.sendEmail(emailAddress!, 'Signup',
					`To complete signup, please click this link:<br><a href="${link}">${link}</a>`,
					`To complete signup, please click this link: ${link}`);
			}

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					pendingUserId: pendingUser.id,
				});
			}

			reply.code(204);
			return;
		} else if (this.meta.approvalRequiredForSignup) {
			if (emailAddress) {
				const result = await this.emailTemplatesService.sendEmailWithTemplates(emailAddress, 'approvalPending');
				if (!result) {
					this.emailService.sendEmail(emailAddress, 'Approval pending',
						'Congratulations! Your account is now pending approval. You will get notified when you have been accepted.',
						'Congratulations! Your account is now pending approval. You will get notified when you have been accepted.');
				}
			}

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					pendingUserId: pendingUser.id,
				});
			}

			const moderators = await this.roleService.getModerators();

			for (const moderator of moderators) {
				const profile = await this.userProfilesRepository.findOneBy({ userId: moderator.id });

				if (profile?.email) {
					const newUserProfile = {
						username: pendingUser.username,
						reason: reason,
					};
					const result = await this.emailTemplatesService.sendEmailWithTemplates(profile.email, 'newUserApprovalWithoutEmail', { newUserProfile });
					if (!result) {
						this.emailService.sendEmail(profile.email, 'New user awaiting approval',
							`A new user called ${pendingUser.username} is awaiting approval with the following reason: "${reason}"`,
							`A new user called ${pendingUser.username} is awaiting approval with the following reason: "${reason}"`);
					}
				}
			}

			reply.code(204);
			return;
		} else {
			try {
				const { account, secret } = await this.signupService.signup({
					username, password, host,
				});

				const res = await this.userEntityService.pack(account, account, {
					schema: 'MeDetailed',
					includeSecrets: true,
				});

				if (ticket) {
					await this.registrationTicketsRepository.update(ticket.id, {
						usedAt: new Date(),
						usedBy: account,
						usedById: account.id,
					});
				}

				return {
					...res,
					token: secret,
				};
			} catch (err) {
				throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
			}
		}
	}

	@bindThis
	public async signupPending(request: FastifyRequest<{ Body: { code: string; } }>, reply: FastifyReply) {
		const ip = request.ip;

		if (ip && !await this.iP2LocationService.checkIP(ip)) {
			reply.code(400);
			reply.code(403);
			return {
				error: {
					message: 'Access is Actively Denied',
					code: 'ACCESS_DENIED',
					id: '1ac836e0-c8b5-11ef-bed9-7724be24f9c5',
				},
			};
		}

		const body = request.body;

		const code = body['code'];

		try {
			const pendingUser = await this.userPendingsRepository.findOneByOrFail({ code });

			if (this.idService.parse(pendingUser.id).date.getTime() + (1000 * 60 * 30) < Date.now() && !pendingUser.emailVerified) {
				try {
					this.userPendingsRepository.delete({
						id: pendingUser.id,
					});
				} catch (e) {
					throw new FastifyReplyError(400, 'DATA ERROR');
				}
				throw new FastifyReplyError(400, 'EXPIRED');
			}

			if (this.meta.approvalRequiredForSignup) {
				try {
					await this.userPendingsRepository.update({ code: code }, {
						emailVerified: true,
					});
				} catch (e) {
					throw new FastifyReplyError(400, 'EXPIRED');
				}

				if (pendingUser.email) {
					const result = await this.emailTemplatesService.sendEmailWithTemplates(pendingUser.email, 'approvalPending');
					if (!result) {
						await this.emailService.sendEmail(pendingUser.email, 'Approval pending',
							'Congratulations! Your account is now pending approval. You will get notified when you have been accepted.',
							'Congratulations! Your account is now pending approval. You will get notified when you have been accepted.');
					}
				}

				const moderators = await this.roleService.getModerators();

				for (const moderator of moderators) {
					const profile = await this.userProfilesRepository.findOneBy({ userId: moderator.id });

					if (profile?.email) {
						const newUserProfile = {
							email: profile.email,
							username: pendingUser.username,
							reason: pendingUser.reason,
						};
						const result = await this.emailTemplatesService.sendEmailWithTemplates(profile.email, 'newUserApprovalWithoutEmail', { newUserProfile });
						if (!result) {
							await this.emailService.sendEmail(profile.email, 'New user awaiting approval',
								`A new user called ${pendingUser.username} (Email: ${pendingUser.email}) is awaiting approval with the following reason: "${pendingUser.reason}"`,
								`A new user called ${pendingUser.username} (Email: ${pendingUser.email}) is awaiting approval with the following reason: "${pendingUser.reason}"`);
						}
					}
				}

				return { pendingApproval: true };
			}

			const { account, secret } = await this.signupService.signup({
				username: pendingUser.username,
				passwordHash: pendingUser.password,
				reason: pendingUser.reason,
				approved: true,
			});

			this.userPendingsRepository.delete({
				id: pendingUser.id,
			});

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: account.id });

			await this.userProfilesRepository.update({ userId: profile.userId }, {
				email: pendingUser.email,
				emailVerified: true,
				emailVerifyCode: null,
			});

			const ticket = await this.registrationTicketsRepository.findOneBy({ pendingUserId: pendingUser.id });
			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedBy: account,
					usedById: account.id,
					pendingUserId: null,
				});
			}

			return this.signinService.signin(request, reply, account as MiLocalUser);
		} catch (err) {
			throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
		}
	}
}
