/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { generateKeyPair } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from '@node-rs/argon2';
import { DataSource, IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiMeta, UsedUsernamesRepository, UsersRepository, SigninsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { MiUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { IdService } from '@/core/IdService.js';
import { MiUserKeypair } from '@/models/UserKeypair.js';
import { MiUsedUsername } from '@/models/UsedUsername.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { bindThis } from '@/decorators.js';
import UsersChart from '@/core/chart/charts/users.js';
import { UtilityService } from '@/core/UtilityService.js';
import { UserService } from '@/core/UserService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { MetaService } from '@/core/MetaService.js';
import { UserSessionsService } from '@/core/UserSessionsService.js';
import type { FastifyRequest } from "fastify";
import { detectDeviceType } from '@/misc/device-type.js';
import { UserRiskScoreService } from '@/core/UserRiskScoreService.js';
import { RiskEventLogService } from '@/core/RiskEventLogService.js';
import { QueueService } from '@/core/QueueService.js';

@Injectable()
export class SignupService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.config)
		private config: Config,

		private utilityService: UtilityService,
		private userService: UserService,
		private userEntityService: UserEntityService,
		private idService: IdService,
		private systemAccountService: SystemAccountService,
		private metaService: MetaService,
		private usersChart: UsersChart,
		private userSessionsService: UserSessionsService,
		private userRiskScoreService: UserRiskScoreService,
		private riskEventLogService: RiskEventLogService,
		private queueService: QueueService,
	) {
	}

	@bindThis
	public async signup(opts: {
		username: MiUser['username'];
		password?: string | null;
		passwordHash?: MiUserProfile['password'] | null;
		host?: string | null;
		reason?: string | null;
		ignorePreservedUsernames?: boolean;
		approved?: boolean;
		ip?: string;
		headers?: Record<string, string> | null | undefined;
		request?: FastifyRequest;
	}) {
		const { username, password, passwordHash, host, reason } = opts;
		const headers: Record<string, string> | null =
			opts.request?.headers as Record<string, string> ??
			opts.headers ??
			null;
		const ip =
			opts.request?.ip ??
			opts.ip ??
			'127.0.0.1';

		let hash = passwordHash;
		const instance = await this.metaService.fetch(true);

		// Validate username
		if (!this.userEntityService.validateLocalUsername(username)) {
			throw new Error('INVALID_USERNAME');
		}

		if (password != null && passwordHash == null) {
			// Validate password
			if (!this.userEntityService.validatePassword(password)) {
				throw new Error('INVALID_PASSWORD');
			}

			if (password.length < 8) {
				throw new Error('INVALID_PASSWORD_LENGTH');
			}

			// Generate hash of password using Argon2id
			hash = await argon2.hash(password, this.config.argon2Config || {
				memoryCost: 4096,
				timeCost: 3,
				parallelism: 1,
				outputLen: 32,
			});
		}

		// Check username duplication
		if (await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
			throw new Error('DUPLICATED_USERNAME');
		}

		// Check deleted username duplication
		if (await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
			throw new Error('USED_USERNAME');
		}

		if (!opts.ignorePreservedUsernames && this.meta.rootUserId != null) {
			const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
			if (isPreserved) {
				throw new Error('USED_USERNAME');
			}

			const hasProhibitedWords = this.utilityService.isKeyWordIncluded(username.toLowerCase(), this.meta.prohibitedWordsForNameOfUser);
			if (hasProhibitedWords) {
				throw new Error('USED_USERNAME');
			}
		}

		const keyPair = await new Promise<string[]>((res, rej) =>
			generateKeyPair('rsa', {
				modulusLength: 2048,
				publicKeyEncoding: {
					type: 'spki',
					format: 'pem',
				},
				privateKeyEncoding: {
					type: 'pkcs8',
					format: 'pem',
					cipher: undefined,
					passphrase: undefined,
				},
			}, (err, publicKey, privateKey) =>
				err ? rej(err) : res([publicKey, privateKey]),
			));

		let account!: MiUser;

		// Start transaction
		await this.db.transaction(async transactionalEntityManager => {
			const exist = await transactionalEntityManager.findOneBy(MiUser, {
				usernameLower: username.toLowerCase(),
				host: IsNull(),
			});

			if (exist) throw new Error(' the username is already used');

			account = await transactionalEntityManager.save(new MiUser({
				id: this.idService.gen(),
				username: username,
				usernameLower: username.toLowerCase(),
				host: this.utilityService.toPunyNullable(host),
				token: null,
				approved: (this.meta.rootUserId === null) || (opts.approved ?? !this.meta.approvalRequiredForSignup),
				signupReason: reason,
			}));

			await transactionalEntityManager.save(new MiUserKeypair({
				publicKey: keyPair[0],
				privateKey: keyPair[1],
				userId: account.id,
			}));

			await transactionalEntityManager.save(new MiUserProfile({
				userId: account.id,
				autoAcceptFollowed: true,
				password: hash,
			}));

			await transactionalEntityManager.save(new MiUsedUsername({
				createdAt: new Date(),
				username: username.toLowerCase(),
			}));
		});

		const signInId = this.idService.gen();

		const sessionToken = await this.userSessionsService.createTokenSafely({
			userId: account.id,
			signInId,
			deviceInfo: detectDeviceType(headers)
		});

		if (!sessionToken) {
			throw new Error('Failed to create session token for new user');
		}

		await this.signinsRepository.insertOne({
			id: signInId,
			userId: account.id,
			ip,
			headers: headers as any,
			success: true,
		});

		this.usersChart.update(account, true);
		this.userService.notifySystemWebhook(account, 'userCreated');

		if (this.meta.rootUserId == null) {
			await this.metaService.update({ rootUserId: account.id });
		}

		setImmediate(async () => {
			try {
				const riskScore = await this.userRiskScoreService.calculateUserRiskScore(account.id);

				// Log risk event to database
				if (riskScore) {
					await this.riskEventLogService.logRiskEvent({
						userId: account.id,
						eventType: 'user_registration',
						riskScore: riskScore.totalScore,
						riskLevel: riskScore.riskLevel,
						details: {
							newUser: true,
							dimensions: riskScore.dimensions,
						},
						timestamp: new Date(),
					});
				}

				// If new user risk score is too low, may require additional review
				if (riskScore && (riskScore.riskLevel === 'poor' || riskScore.riskLevel === 'fair')) {
					// Mark high-risk users as requiring approval (backend only, don't modify user-visible reason)
					if (!account.approved && this.meta.approvalRequiredForSignup) {
						await this.usersRepository.update(account.id, {
							approved: false,
							signupReason: reason || null,
						});
					}
				}

				// Schedule risk score update after delay using dbQueue
				this.queueService.dbQueue.add('updateUserRiskScore', {
					userId: account.id,
					reason: 'new_registration',
				}, {
					delay: 60000,
				});
			} catch (error) {
				console.error(`Failed to calculate risk score for new user ${account.id}:`, error);
			}
		});

		return { account, secret: sessionToken };
	}
}
