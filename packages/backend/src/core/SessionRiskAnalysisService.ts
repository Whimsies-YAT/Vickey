/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserSessionsRepository, SigninsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';

export interface SessionRiskFactors {
	multipleActiveTokens: boolean;
	suspiciousTokenPattern: boolean;
	rapidTokenGeneration: boolean;
	unusualSessionDuration: boolean;
	deviceFingerprinting: boolean;
	ipJumping: boolean;
	suspiciousUserAgent: boolean;
	score: number;
	details: Record<string, any>;
}

@Injectable()
export class SessionRiskAnalysisService {
	constructor(
		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
	) {
	}

	@bindThis
	public async analyzeSessionRisk(userId: string): Promise<SessionRiskFactors> {
		const factors: SessionRiskFactors = {
			multipleActiveTokens: false,
			suspiciousTokenPattern: false,
			rapidTokenGeneration: false,
			unusualSessionDuration: false,
			deviceFingerprinting: false,
			ipJumping: false,
			suspiciousUserAgent: false,
			score: 0,
			details: {},
		};

		const activeSessions = await this.userSessionsRepository.find({
			where: {
				userId,
				createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
			},
			order: {
				createdAt: 'DESC',
			},
		});

		if (activeSessions.length > 5) {
			factors.multipleActiveTokens = true;
			factors.score += 20;
			factors.details.activeTokenCount = activeSessions.length;
		}

		if (activeSessions.length >= 2) {
			const tokenIntervals = [];
			for (let i = 1; i < activeSessions.length; i++) {
				const interval = activeSessions[i - 1].createdAt.getTime() - activeSessions[i].createdAt.getTime();
				tokenIntervals.push(interval);
			}

			const rapidGenerations = tokenIntervals.filter(interval => interval < 60 * 1000).length;
			if (rapidGenerations > 2) {
				factors.rapidTokenGeneration = true;
				factors.score += 25;
				factors.details.rapidTokenGenerations = rapidGenerations;
			}

			if (this.detectPatternInIntervals(tokenIntervals)) {
				factors.suspiciousTokenPattern = true;
				factors.score += 15;
			}
		}

		const allSignins = await this.signinsRepository.find({
			where: {
				userId,
			},
			order: {
				id: 'DESC',
			},
			take: 200,
		});

		const timeThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
		const signins = allSignins.filter(signin => {
			try {
				const signinTime = this.idService.parse(signin.id).date.getTime();
				return signinTime > timeThreshold;
			} catch {
				return false;
			}
		}).slice(0, 100);

		if (signins.length > 0) {
			const uniqueIps = new Set(signins.map(s => s.ip));
			if (uniqueIps.size > 10) {
				factors.ipJumping = true;
				factors.score += 30;
				factors.details.uniqueIpCount = uniqueIps.size;
			}

			const recentSignins = signins.slice(0, 10);
			const recentIps = new Set(recentSignins.map(s => s.ip));
			if (recentIps.size > 5) {
				factors.score += 20;
				factors.details.recentIpChanges = recentIps.size;
			}

			const userAgents = signins.map(s => s.headers?.['user-agent']).filter(Boolean);
			const uniqueUserAgents = new Set(userAgents);

			const suspiciousAgents = userAgents.filter(ua =>
				ua.includes('bot') ||
				ua.includes('crawler') ||
				ua.includes('headless') ||
				ua.includes('phantom') ||
				ua.length < 20
			);

			if (suspiciousAgents.length > 0) {
				factors.suspiciousUserAgent = true;
				factors.score += 25;
				factors.details.suspiciousUserAgents = suspiciousAgents;
			}

			if (uniqueUserAgents.size > 10) {
				factors.deviceFingerprinting = true;
				factors.score += 15;
				factors.details.uniqueUserAgentCount = uniqueUserAgents.size;
			}
		}

		const registrationTime = this.idService.parse(userId).date;
		const registrationMinute = registrationTime.getMinutes();
		const registrationSecond = registrationTime.getSeconds();

		if ((registrationMinute === 0 && registrationSecond === 0) ||
			(registrationMinute === 30 && registrationSecond === 0)) {
			factors.score += 10;
			factors.details.suspiciousRegistrationTime = true;
		}

		const nearbyUsers = await this.findNearbyRegistrations(userId, 100);
		if (nearbyUsers.length > 10) {
			factors.score += 20;
			factors.details.nearbyRegistrations = nearbyUsers.length;
		}

		factors.score = Math.min(100, factors.score);

		return factors;
	}

	@bindThis
	private detectPatternInIntervals(intervals: number[]): boolean {
		if (intervals.length < 3) return false;

		const tolerance = 5000; // 5秒
		let patternCount = 0;

		for (let i = 0; i < intervals.length - 1; i++) {
			for (let j = i + 1; j < intervals.length; j++) {
				if (Math.abs(intervals[i] - intervals[j]) < tolerance) {
					patternCount++;
				}
			}
		}

		return patternCount > intervals.length * 0.3;
	}

	@bindThis
	private async findNearbyRegistrations(userId: string, windowSeconds: number = 100): Promise<string[]> {
		const userIdTime = this.idService.parse(userId).date.getTime();

		const startTime = new Date(userIdTime - windowSeconds * 1000);
		const endTime = new Date(userIdTime + windowSeconds * 1000);

		const startId = this.idService.gen(startTime.getTime());
		const endId = this.idService.gen(endTime.getTime());

		const nearbyUsers = await this.usersRepository.createQueryBuilder('user')
			.where('user.id > :startId AND user.id < :endId AND user.id != :userId', {
				startId,
				endId,
				userId,
			})
			.select(['user.id'])
			.take(50)
			.getMany();

		return nearbyUsers.map(u => u.id);
	}

	@bindThis
	public async analyzeLoginPattern(userId: string): Promise<{
		normalLoginTimes: number[];
		currentRisk: number;
		isAnomalous: boolean;
	}> {
		const signins = await this.signinsRepository.find({
			where: {
				userId,
				success: true,
			},
			order: {
				id: 'DESC',
			},
			take: 100,
		});

		const loginHours = signins.map(s => {
			try {
				return this.idService.parse(s.id).date.getHours();
			} catch {
				return 0;
			}
		});
		const hourFrequency: Record<number, number> = {};

		for (const hour of loginHours) {
			hourFrequency[hour] = (hourFrequency[hour] || 0) + 1;
		}

		const normalHours = Object.entries(hourFrequency)
			.filter(([_, count]) => count > signins.length * 0.1)
			.map(([hour]) => parseInt(hour));

		const currentHour = new Date().getHours();
		const isAnomalous = !normalHours.includes(currentHour) && signins.length > 10;

		return {
			normalLoginTimes: normalHours,
			currentRisk: isAnomalous ? 30 : 0,
			isAnomalous,
		};
	}

	@bindThis
	public async detectSessionHijacking(userId: string, currentIp: string, currentUserAgent: string): Promise<{
		risk: number;
		reasons: string[];
	}> {
		const recentSignin = await this.signinsRepository.findOne({
			where: {
				userId,
				success: true,
			},
			order: {
				id: 'DESC',
			},
		});

		const reasons: string[] = [];
		let risk = 0;

		if (recentSignin) {
			if (recentSignin.ip !== currentIp) {
				try {
					const signinTime = this.idService.parse(recentSignin.id).date.getTime();
					const timeDiff = Date.now() - signinTime;
					if (timeDiff < 5 * 60 * 1000) {
						risk += 40;
						reasons.push('Rapid IP address change');
					}
				} catch {
					// If we can't parse the ID timestamp, skip this check
				}
			}

			const lastUserAgent = recentSignin.headers?.['user-agent'];
			if (lastUserAgent && lastUserAgent !== currentUserAgent) {
				risk += 20;
				reasons.push('Device fingerprint change');
			}
		}

		return { risk, reasons };
	}
}
