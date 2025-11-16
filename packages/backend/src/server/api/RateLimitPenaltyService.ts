/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { UserIpsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { RiskEventLogService } from '@/core/RiskEventLogService.js';
import { MultiAccountDetectionService } from '@/core/MultiAccountDetectionService.js';
import { getIpHash } from '@/misc/get-ip-hash.js';

const VIOLATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface RateLimitViolationContext {
	userId?: string | null;
	ip?: string | null;
	endpoint?: string;
	limitKey: string;
	reason?: string;
	actor: string;
}

@Injectable()
export class RateLimitPenaltyService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userIpsRepository)
		private userIpsRepository: UserIpsRepository,

		private multiAccountDetectionService: MultiAccountDetectionService,

		private riskEventLogService: RiskEventLogService,
	) {}

	@bindThis
	public async recordViolation(context: RateLimitViolationContext): Promise<void> {
		const timestamp = new Date();
		const targets = await this.resolveTargets(context.userId, context.ip);
		if (targets.length === 0) return;

		await Promise.all(targets.map(async userId => {
			const count = await this.pushViolationRecord(userId, timestamp);
			const severity = this.calculateSeverity(count);

			await this.riskEventLogService.logRiskEvent({
				userId,
				eventType: 'rate_limit_violation',
				riskScore: 0,
				riskLevel: 'fair',
				details: {
					limitKey: context.limitKey,
					endpoint: context.endpoint,
					reason: context.reason,
					count,
					ipHash: context.ip ? getIpHash(context.ip) : null,
					actor: context.actor,
				},
				timestamp,
				severity,
				decayHalfLifeDays: 15,
			});
		}));
	}

	@bindThis
	private async resolveTargets(userId?: string | null, ip?: string | null): Promise<string[]> {
		const result = new Set<string>();
		if (userId) {
			result.add(userId);
			const links = await this.multiAccountDetectionService.getAccountLinks(userId);
			for (const link of links) {
				result.add(link.primaryUserId);
				result.add(link.linkedUserId);
			}
		}

		if (!userId && ip) {
			const records = await this.userIpsRepository.find({
				where: { ip },
				select: ['userId'],
				order: { createdAt: 'DESC' },
				take: 5,
			});

			for (const record of records) {
				result.add(record.userId);
				const links = await this.multiAccountDetectionService.getAccountLinks(record.userId);
				for (const link of links) {
					result.add(link.primaryUserId);
					result.add(link.linkedUserId);
				}
			}
		}

		return Array.from(result);
	}

	@bindThis
	private async pushViolationRecord(userId: string, timestamp: Date): Promise<number> {
		const key = `risk:rate-limit:violations:${userId}`;
		const score = timestamp.getTime();
		await this.redisClient.zadd(key, score, score.toString());
		await this.redisClient.zremrangebyscore(key, 0, score - VIOLATION_WINDOW_MS);
		return this.redisClient.zcard(key);
	}

	@bindThis
	private calculateSeverity(count: number): number {
		if (count <= 1) return 4;
		if (count <= 3) return 7;
		if (count <= 5) return 11;
		if (count <= 10) return 16;
		if (count <= 20) return 20;
		return 24;
	}
}
