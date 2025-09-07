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
	| 'suspicious_activity';

export interface RiskEventData {
	userId: string;
	eventType: RiskEventType;
	riskScore: number;
	riskLevel: 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent';
	details: Record<string, any>;
	timestamp: Date;
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
				details: event.details,
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
