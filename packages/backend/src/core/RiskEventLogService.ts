/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ModerationLogsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { SystemWebhookService } from '@/core/SystemWebhookService.js';
import type { MiUser } from '@/models/User.js';

export type RiskEventType =
	| 'user_registration'
	| 'user_login'
	| 'high_risk_note'
	| 'high_risk_follow'
	| 'high_risk_message'
	| 'multi_account_detected'
	| 'risk_level_changed'
	| 'suspicious_activity'
	| 'rate_limit_violation';

export interface RiskEventData {
	userId: string;
	eventType: RiskEventType;
	riskScore: number;
	riskLevel: 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent';
	details: Record<string, any>;
	timestamp: Date;
	severity?: number;
	decayHalfLifeDays?: number;
}

export interface RiskEventImpact {
	totalImpact: number;
	breakdown: Array<{
		id: string;
		eventType: RiskEventType;
		severity: number;
		decayFactor: number;
		impact: number;
		timestamp: string;
	}>;
}

@Injectable()
export class RiskEventLogService {
	constructor(
		@Inject(DI.moderationLogsRepository)
		private moderationLogsRepository: ModerationLogsRepository,

		private idService: IdService,
		private systemWebhookService: SystemWebhookService,
	) {
	}

	@bindThis
	public async logRiskEvent(event: RiskEventData): Promise<void> {
		const logId = this.idService.gen(event.timestamp.getTime());

		await this.moderationLogsRepository.insert({
			id: logId,
			userId: event.userId,
			type: 'riskEvent',
			info: {
				eventType: event.eventType,
				riskScore: event.riskScore,
				riskLevel: event.riskLevel,
				details: {
					severity: event.severity,
					decayHalfLifeDays: event.decayHalfLifeDays,
					...event.details,
				},
			} as any,
		});

		await this.sendWebhookNotification(event);
	}

	@bindThis
	public async logHighRiskRegistration(user: MiUser, riskScore: number, riskLevel: string, details: any): Promise<void> {
		await this.logRiskEvent({
			userId: user.id,
			eventType: 'user_registration',
			riskScore,
			riskLevel: riskLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details: {
				username: user.username,
				host: user.host,
				...details,
			},
			timestamp: new Date(),
			severity: details?.severity ?? 8,
			decayHalfLifeDays: details?.decayHalfLifeDays ?? 14,
		});
	}

	@bindThis
	public async logHighRiskLogin(userId: string, riskScore: number, riskLevel: string, details: any): Promise<void> {
		await this.logRiskEvent({
			userId,
			eventType: 'user_login',
			riskScore,
			riskLevel: riskLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details,
			timestamp: new Date(),
			severity: details?.severity ?? 6,
			decayHalfLifeDays: details?.decayHalfLifeDays ?? 10,
		});
	}

	@bindThis
	public async logHighRiskNote(userId: string, riskScore: number, riskLevel: string, noteId: string): Promise<void> {
		await this.logRiskEvent({
			userId,
			eventType: 'high_risk_note',
			riskScore,
			riskLevel: riskLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details: {
				noteId,
			},
			timestamp: new Date(),
			severity: 12,
			decayHalfLifeDays: 21,
		});
	}

	@bindThis
	public async logHighRiskFollow(followerId: string, followeeId: string, riskScore: number, riskLevel: string): Promise<void> {
		await this.logRiskEvent({
			userId: followerId,
			eventType: 'high_risk_follow',
			riskScore,
			riskLevel: riskLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details: {
				followeeId,
			},
			timestamp: new Date(),
			severity: 10,
			decayHalfLifeDays: 14,
		});
	}

	@bindThis
	public async logHighRiskMessage(fromUserId: string, toUserId: string, riskScore: number, riskLevel: string): Promise<void> {
		await this.logRiskEvent({
			userId: fromUserId,
			eventType: 'high_risk_message',
			riskScore,
			riskLevel: riskLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details: {
				toUserId,
			},
			timestamp: new Date(),
			severity: 10,
			decayHalfLifeDays: 14,
		});
	}

	@bindThis
	public async logMultiAccountDetected(userId: string, linkedAccounts: string[]): Promise<void> {
		await this.logRiskEvent({
			userId,
			eventType: 'multi_account_detected',
			riskScore: 0,
			riskLevel: 'good',
			details: {
				linkedAccounts,
			},
			timestamp: new Date(),
			severity: 15,
			decayHalfLifeDays: 30,
		});
	}

	@bindThis
	public async logRiskLevelChanged(userId: string, oldLevel: string, newLevel: string, oldScore: number, newScore: number): Promise<void> {
		await this.logRiskEvent({
			userId,
			eventType: 'risk_level_changed',
			riskScore: newScore,
			riskLevel: newLevel as 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent',
			details: {
				oldLevel,
				oldScore,
				changeAmount: newScore - oldScore,
			},
			timestamp: new Date(),
			severity: Math.max(5, Math.min(20, Math.abs(newScore - oldScore))),
			decayHalfLifeDays: 21,
		});
	}

	@bindThis
	private async sendWebhookNotification(event: RiskEventData): Promise<void> {
		try {
			await this.systemWebhookService.enqueueSystemWebhook(
				'abuseReport',
				{
					type: 'riskEvent',
					eventType: event.eventType,
					userId: event.userId,
					riskScore: event.riskScore,
					riskLevel: event.riskLevel,
					details: event.details,
					timestamp: event.timestamp.toISOString(),
				} as any
			);
		} catch (error) {
			console.error(`Failed to send risk event webhook:`, error);
		}
	}

	@bindThis
	private estimateSeverity(info: any): number {
		if (info?.details?.severity != null) {
			return Number(info.details.severity) || 0;
		}

		if (info?.details?.changeAmount != null) {
			return Math.min(25, Math.max(5, Math.abs(info.details.changeAmount)));
		}

		if (info?.riskScore != null) {
			return Math.min(20, Math.max(6, 100 - info.riskScore));
		}

		return 8;
	}

	@bindThis
	private getDecayHalfLife(info: any): number {
		if (info?.details?.decayHalfLifeDays != null) {
			return Math.max(1, Number(info.details.decayHalfLifeDays));
		}

		return 14;
	}

	@bindThis
	public async calculateDecayedImpact(userId: string, options: { lookbackDays?: number; limit?: number } = {}): Promise<RiskEventImpact> {
		const lookbackDays = options.lookbackDays ?? 60;
		const limit = options.limit ?? 200;
		const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
		const sinceId = this.idService.gen(since.getTime());

		const logs = await this.moderationLogsRepository.createQueryBuilder('log')
			.where('log.type = :type', { type: 'riskEvent' })
			.andWhere('log.userId = :userId', { userId })
			.andWhere('log.id > :sinceId', { sinceId })
			.orderBy('log.id', 'DESC')
			.take(limit)
			.getMany();

		const now = Date.now();
		const breakdown: RiskEventImpact['breakdown'] = [];
		let totalImpact = 0;

		for (const log of logs) {
			const timestamp = this.idService.parse(log.id).date;
			const info = log.info as any;
			const severity = this.estimateSeverity(info);
			if (severity <= 0) continue;

			const halfLifeDays = this.getDecayHalfLife(info);
			const ageDays = (now - timestamp.getTime()) / (24 * 60 * 60 * 1000);
			const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);
			const impact = severity * decayFactor;

			totalImpact += impact;
			breakdown.push({
				id: log.id,
				eventType: info.eventType as RiskEventType,
				severity,
				decayFactor,
				impact,
				timestamp: timestamp.toISOString(),
			});
		}

		return {
			totalImpact,
			breakdown,
		};
	}

	@bindThis
	public async getRiskEventsForUser(userId: string, limit = 100): Promise<any[]> {
		const logs = await this.moderationLogsRepository.createQueryBuilder('log')
			.where('log.type = :type', { type: 'riskEvent' })
			.andWhere('log.userId = :userId', { userId })
			.orderBy('log.id', 'DESC')
			.take(limit)
			.getMany();

		return logs.map(log => ({
			id: log.id,
			userId: log.userId,
			...log.info,
			timestamp: this.idService.parse(log.id).date.toISOString(),
		}));
	}

	@bindThis
	public async getRecentHighRiskEvents(hours = 24, limit = 100): Promise<any[]> {
		const since = new Date(Date.now() - hours * 60 * 60 * 1000);
		const sinceId = this.idService.gen(since.getTime());

		const logs = await this.moderationLogsRepository.createQueryBuilder('log')
			.where('log.type = :type', { type: 'riskEvent' })
			.andWhere('log.id > :sinceId', { sinceId })
			.orderBy('log.id', 'DESC')
			.take(limit)
			.getMany();

		return logs.map(log => ({
			id: log.id,
			userId: log.userId,
			...log.info,
			timestamp: this.idService.parse(log.id).date.toISOString(),
		}));
	}
}
