/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { NotesRepository, SigninsRepository, UserIpsRepository, UserSessionsRepository, FollowingsRepository, NoteReactionsRepository, UsersRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import * as Redis from 'ioredis';
import * as crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import { IdService } from '@/core/IdService.js';
import { In } from 'typeorm';

export interface AccountLink {
	id: string;
	primaryUserId: string;
	linkedUserId: string;
	confidence: number;
	detectionMethods: string[];
	createdAt: Date;
	expiresAt?: Date;
	penaltyMultiplier: number;
	isManual: boolean;
	metadata: Record<string, any>;
}

export interface DetectionResult {
	isLinked: boolean;
	confidence: number;
	methods: string[];
	evidence: Record<string, any>;
}

@Injectable()
export class MultiAccountDetectionService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userIpsRepository)
		private userIpsRepository: UserIpsRepository,

		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		private idService: IdService,
	) {
		this.initializeService().catch(err => {
			console.error('Failed to initialize MultiAccountDetectionService:', err);
		});
	}

	private readonly thresholds = {
		ipSimilarity: 0.8,
		deviceSimilarity: 0.85,
		behaviorSimilarity: 0.75,
		contentSimilarity: 0.8,
		timingCorrelation: 0.7,
		overallConfidence: 0.65,
		socialGraphSuspicion: 0.6,
	};

	private readonly penaltyConfig = {
		initialMultiplier: 1.5,
		decayRate: 0.1,
		minMultiplier: 1.0,
		maxDuration: 30 * 24 * 60 * 60 * 1000,
	};

	@bindThis
	private async initializeService(): Promise<void> {
		try {
		} catch (error) {
			console.error('Failed to initialize MultiAccountDetectionService:', error);
		}
	}

	@bindThis
	public async detectLinkedAccounts(userId1: string, userId2: string): Promise<DetectionResult> {
		const methods: string[] = [];
		const evidence: Record<string, any> = {};
		let totalConfidence = 0;
		let methodCount = 0;

		const ipSimilarity = await this.analyzeIpSimilarity(userId1, userId2);
		if (ipSimilarity > this.thresholds.ipSimilarity) {
			methods.push('ip_overlap');
			evidence.ipSimilarity = ipSimilarity;
			totalConfidence += ipSimilarity;
			methodCount++;
		}

		const deviceSimilarity = await this.analyzeDeviceSimilarity(userId1, userId2);
		if (deviceSimilarity > this.thresholds.deviceSimilarity) {
			methods.push('device_fingerprint');
			evidence.deviceSimilarity = deviceSimilarity;
			totalConfidence += deviceSimilarity;
			methodCount++;
		}

		const behaviorSimilarity = await this.analyzeBehaviorPatterns(userId1, userId2);
		if (behaviorSimilarity > this.thresholds.behaviorSimilarity) {
			methods.push('behavior_pattern');
			evidence.behaviorSimilarity = behaviorSimilarity;
			totalConfidence += behaviorSimilarity;
			methodCount++;
		}

		const contentSimilarity = await this.analyzeContentSimilarity(userId1, userId2);
		if (contentSimilarity > this.thresholds.contentSimilarity) {
			methods.push('content_similarity');
			evidence.contentSimilarity = contentSimilarity;
			totalConfidence += contentSimilarity;
			methodCount++;
		}

		const timingCorrelation = await this.analyzeTimingCorrelation(userId1, userId2);
		if (timingCorrelation > this.thresholds.timingCorrelation) {
			methods.push('timing_correlation');
			evidence.timingCorrelation = timingCorrelation;
			totalConfidence += timingCorrelation;
			methodCount++;
		}

		const socialCorrelation = await this.analyzeSocialGraphCorrelation(userId1, userId2);
		if (socialCorrelation > this.thresholds.socialGraphSuspicion) {
			methods.push('social_graph');
			evidence.socialCorrelation = socialCorrelation;
			totalConfidence += socialCorrelation;
			methodCount++;
		}

		const bayesianConfidence = this.calculateBayesianConfidence(methods, evidence);

		return {
			isLinked: bayesianConfidence > this.thresholds.overallConfidence,
			confidence: bayesianConfidence,
			methods,
			evidence,
		};
	}

	@bindThis
	private async analyzeIpSimilarity(userId1: string, userId2: string): Promise<number> {
		const [ips1, ips2] = await Promise.all([
			this.userIpsRepository.find({
				where: { userId: userId1 },
				select: ['ip'],
				take: 100,
			}),
			this.userIpsRepository.find({
				where: { userId: userId2 },
				select: ['ip'],
				take: 100,
			}),
		]);

		if (ips1.length === 0 || ips2.length === 0) return 0;

		const ipSet1 = new Set(ips1.map(i => i.ip));
		const ipSet2 = new Set(ips2.map(i => i.ip));

		const intersection = new Set([...ipSet1].filter(x => ipSet2.has(x)));
		const union = new Set([...ipSet1, ...ipSet2]);

		const similarity = intersection.size / union.size;

		const subnet1 = this.extractSubnets(ipSet1);
		const subnet2 = this.extractSubnets(ipSet2);
		const subnetSimilarity = this.calculateSetSimilarity(subnet1, subnet2);

		return similarity * 0.7 + subnetSimilarity * 0.3;
	}

	@bindThis
	private async analyzeDeviceSimilarity(userId1: string, userId2: string): Promise<number> {
		const [logins1, logins2] = await Promise.all([
			this.signinsRepository.find({
				where: { userId: userId1 },
				take: 50,
				order: { id: 'DESC' },
			}),
			this.signinsRepository.find({
				where: { userId: userId2 },
				take: 50,
				order: { id: 'DESC' },
			}),
		]);

		if (logins1.length === 0 || logins2.length === 0) return 0;

		const devices1 = logins1.map(l => this.extractDeviceFingerprint(l.headers));
		const devices2 = logins2.map(l => this.extractDeviceFingerprint(l.headers));

		let maxSimilarity = 0;
		for (const d1 of devices1) {
			for (const d2 of devices2) {
				const similarity = this.compareDeviceFingerprints(d1, d2);
				maxSimilarity = Math.max(maxSimilarity, similarity);
			}
		}

		return maxSimilarity;
	}

	@bindThis
	private async analyzeBehaviorPatterns(userId1: string, userId2: string): Promise<number> {
		const [notes1, notes2] = await Promise.all([
			this.notesRepository.find({
				where: { userId: userId1 },
				select: ['id', 'text'],
				take: 100,
				order: { id: 'DESC' },
			}),
			this.notesRepository.find({
				where: { userId: userId2 },
				select: ['id', 'text'],
				take: 100,
				order: { id: 'DESC' },
			}),
		]);

		if (notes1.length < 10 || notes2.length < 10) return 0;

		const timePattern1 = this.extractTimePattern(notes1.map(n => n.id));
		const timePattern2 = this.extractTimePattern(notes2.map(n => n.id));
		const timeSimilarity = this.compareTimePatterns(timePattern1, timePattern2);

		const freqPattern1 = this.extractFrequencyPattern(notes1.map(n => n.id));
		const freqPattern2 = this.extractFrequencyPattern(notes2.map(n => n.id));
		const freqSimilarity = this.compareFrequencyPatterns(freqPattern1, freqPattern2);

		const lengthDist1 = this.extractLengthDistribution(notes1.map(n => n.text?.length || 0));
		const lengthDist2 = this.extractLengthDistribution(notes2.map(n => n.text?.length || 0));
		const lengthSimilarity = this.compareDistributions(lengthDist1, lengthDist2);

		return (timeSimilarity * 0.4 + freqSimilarity * 0.3 + lengthSimilarity * 0.3);
	}

	@bindThis
	private async analyzeContentSimilarity(userId1: string, userId2: string): Promise<number> {
		const [notes1, notes2] = await Promise.all([
			this.notesRepository.find({
				where: { userId: userId1 },
				select: ['text'],
				take: 50,
				order: { id: 'DESC' },
			}),
			this.notesRepository.find({
				where: { userId: userId2 },
				select: ['text'],
				take: 50,
				order: { id: 'DESC' },
			}),
		]);

		if (notes1.length < 5 || notes2.length < 5) return 0;

		const text1 = notes1.map(n => n.text || '').join(' ');
		const text2 = notes2.map(n => n.text || '').join(' ');

		const words1 = new Set(text1.toLowerCase().split(/\s+/));
		const words2 = new Set(text2.toLowerCase().split(/\s+/));

		if (words1.size === 0 || words2.size === 0) return 0;

		const intersection = new Set([...words1].filter(x => words2.has(x)));
		const similarity = (2 * intersection.size) / (words1.size + words2.size);

		const styleSimlarity = this.analyzeWritingStyle(text1, text2);

		return similarity * 0.6 + styleSimlarity * 0.4;
	}

	@bindThis
	private async analyzeTimingCorrelation(userId1: string, userId2: string): Promise<number> {
		const [logins1, logins2] = await Promise.all([
			this.signinsRepository.find({
				where: { userId: userId1 },
				select: ['id'],
				take: 100,
				order: { id: 'DESC' },
			}),
			this.signinsRepository.find({
				where: { userId: userId2 },
				select: ['id'],
				take: 100,
				order: { id: 'DESC' },
			}),
		]);

		if (logins1.length < 5 || logins2.length < 5) return 0;

		const times1 = logins1.map(l => parseInt(l.id.slice(0, 8), 36) + 946684800000);
		const times2 = logins2.map(l => parseInt(l.id.slice(0, 8), 36) + 946684800000);

		let exclusivePatterns = 0;
		const timeWindow = 5 * 60 * 1000;

		for (let i = 0; i < times1.length - 1; i++) {
			for (const time2 of times2) {
				if (Math.abs(times1[i] - time2) < timeWindow) {
					exclusivePatterns++;
				}
			}
		}

		const correlation = exclusivePatterns / Math.min(times1.length, times2.length);
		return Math.min(1, correlation);
	}

	@bindThis
	private async analyzeSocialGraphCorrelation(userId1: string, userId2: string): Promise<number> {
		let suspicionScore = 0;
		const evidence = [];

		const [follows1to2, follows2to1] = await Promise.all([
			this.followingsRepository.findOne({
				where: { followerId: userId1, followeeId: userId2 },
				select: ['id'],
			}),
			this.followingsRepository.findOne({
				where: { followerId: userId2, followeeId: userId1 },
				select: ['id'],
			}),
		]);

		if (!follows1to2 && !follows2to1) {
			suspicionScore += 0.2;
			evidence.push('no_mutual_follow');
		}

		const [followers1, followers2] = await Promise.all([
			this.followingsRepository.find({
				where: { followeeId: userId1 },
				select: ['followerId'],
				take: 200,
			}),
			this.followingsRepository.find({
				where: { followeeId: userId2 },
				select: ['followerId'],
				take: 200,
			}),
		]);

		if (followers1.length > 5 && followers2.length > 5) {
			const followerSet1 = new Set(followers1.map(f => f.followerId));
			const followerSet2 = new Set(followers2.map(f => f.followerId));
			const mutualFollowers = new Set([...followerSet1].filter(x => followerSet2.has(x)));

			mutualFollowers.delete(userId1);
			mutualFollowers.delete(userId2);

			const mutualRatio = mutualFollowers.size / Math.min(followerSet1.size, followerSet2.size, 50);

			if (mutualRatio < 0.1) {
				suspicionScore += 0.3;
				evidence.push(`low_mutual_followers: ${mutualFollowers.size}/${Math.min(followerSet1.size, followerSet2.size)}`);
			}
		}

		const [user1Notes, user2Notes] = await Promise.all([
			this.notesRepository.find({
				where: { userId: userId1 },
				select: ['id'],
				take: 100,
				order: { id: 'DESC' },
			}),
			this.notesRepository.find({
				where: { userId: userId2 },
				select: ['id'],
				take: 100,
				order: { id: 'DESC' },
			}),
		]);

		if (user1Notes.length > 10 && user2Notes.length > 10) {
			const noteIds1 = user1Notes.map(n => n.id);
			const noteIds2 = user2Notes.map(n => n.id);

			const reactions1to2 = noteIds1.length > 0
				? await this.noteReactionsRepository.count({
					where: {
						userId: userId2,
						noteId: In(noteIds1),
					},
				})
				: 0;

			const reactions2to1 = noteIds2.length > 0
				? await this.noteReactionsRepository.count({
					where: {
						userId: userId1,
						noteId: In(noteIds2),
					},
				})
				: 0;

			const totalReactions = reactions1to2 + reactions2to1;
			const maxPossibleReactions = Math.min(noteIds1.length + noteIds2.length, 50);

			if (totalReactions === 0 && maxPossibleReactions > 20) {
				suspicionScore += 0.4;
				evidence.push('no_interactions');
			} else if (totalReactions < maxPossibleReactions * 0.05) {
				suspicionScore += 0.2;
				evidence.push(`low_interactions: ${totalReactions}/${maxPossibleReactions}`);
			}
		}

		const [following1, following2] = await Promise.all([
			this.followingsRepository.find({
				where: { followerId: userId1 },
				select: ['followeeId'],
				take: 200,
			}),
			this.followingsRepository.find({
				where: { followerId: userId2 },
				select: ['followeeId'],
				take: 200,
			}),
		]);

		if (following1.length > 10 && following2.length > 10) {
			const followingSet1 = new Set(following1.map(f => f.followeeId));
			const followingSet2 = new Set(following2.map(f => f.followeeId));

			followingSet1.delete(userId1);
			followingSet1.delete(userId2);
			followingSet2.delete(userId1);
			followingSet2.delete(userId2);

			const intersection = new Set([...followingSet1].filter(x => followingSet2.has(x)));
			const union = new Set([...followingSet1, ...followingSet2]);

			if (union.size > 0) {
				const similarity = intersection.size / union.size;

				if (similarity > 0.7) {
					suspicionScore += 0.3;
					evidence.push(`high_following_similarity: ${similarity.toFixed(2)}`);
				} else if (similarity > 0.5) {
					suspicionScore += 0.15;
					evidence.push(`moderate_following_similarity: ${similarity.toFixed(2)}`);
				}
			}
		}

		return Math.min(1, suspicionScore);
	}

	@bindThis
	public async createMultiAccountGroup(
		userIds: string[],
		detection: DetectionResult,
		isManual: boolean = false,
	): Promise<{
		groupId: string;
		userIds: string[];
		links: AccountLink[];
		groupInfo: any;
	}> {
		if (userIds.length < 2) {
			throw new Error('At least 2 user IDs are required for a group');
		}

		const groupId = crypto.randomUUID();
		const now = new Date();
		const groupName = detection.evidence?.groupName || `Group-${Date.now()}`;
		const groupDescription = detection.evidence?.groupDescription;

		const groupMetadata = {
			id: groupId,
			name: groupName,
			description: groupDescription,
			userIds: userIds,
			createdAt: now,
			createdBy: detection.evidence?.adminId,
			isManual,
			confidence: detection.confidence,
		};

		await this.redisClient.set(
			`account-group:${groupId}`,
			JSON.stringify(groupMetadata),
			'EX',
			isManual ? 86400 * 365 : this.penaltyConfig.maxDuration / 1000,
		);

		const links = [];
		for (let i = 0; i < userIds.length; i++) {
			for (let j = i + 1; j < userIds.length; j++) {
				const link = await this.createAccountLink(
					userIds[i],
					userIds[j],
					{
						...detection,
						evidence: {
							...detection.evidence,
							groupId: groupId,
							groupName: groupName,
							groupDescription: groupDescription,
						},
					},
					isManual
				);
				links.push(link);
			}
		}

		for (const userId of userIds) {
			await this.redisClient.sadd(`user-groups:${userId}`, groupId);
		}

		await this.syncMultiAccountScores(userIds);

		return {
			groupId,
			userIds,
			links,
			groupInfo: {
				name: groupName,
				description: groupDescription,
				userCount: userIds.length,
				linkCount: links.length,
				createdAt: now,
			},
		};
	}

	@bindThis
	public async createAccountLink(
		primaryUserId: string,
		linkedUserId: string,
		detection: DetectionResult,
		isManual: boolean = false,
	): Promise<AccountLink> {
		const linkId = crypto.randomUUID();
		const now = new Date();
		const expiresAt = isManual ? undefined : new Date(now.getTime() + this.penaltyConfig.maxDuration);

		const link: AccountLink = {
			id: linkId,
			primaryUserId,
			linkedUserId,
			confidence: detection.confidence,
			detectionMethods: detection.methods,
			createdAt: now,
			expiresAt,
			penaltyMultiplier: this.penaltyConfig.initialMultiplier,
			isManual,
			metadata: detection.evidence,
		};

		await this.redisClient.set(
			`account-link:${linkId}`,
			JSON.stringify(link),
			'EX',
			this.penaltyConfig.maxDuration / 1000,
		);

		await this.redisClient.sadd(`user-links:${primaryUserId}`, linkId);
		await this.redisClient.sadd(`user-links:${linkedUserId}`, linkId);

		if (!detection.evidence?.groupId) {
			await this.syncInitialScores(primaryUserId, linkedUserId);
		}

		return link;
	}

	@bindThis
	public async getAccountLinks(userId: string): Promise<AccountLink[]> {
		const linkIds = await this.redisClient.smembers(`user-links:${userId}`);
		const links: AccountLink[] = [];

		for (const linkId of linkIds) {
			const linkData = await this.redisClient.get(`account-link:${linkId}`);
			if (linkData) {
				const link = JSON.parse(linkData) as AccountLink;
				link.penaltyMultiplier = this.calculateCurrentPenalty(link);
				links.push(link);
			}
		}

		return links;
	}

	@bindThis
	public async getAccountNetwork(userId: string): Promise<{
		nodes: { id: string; name: string; type: 'user'; metadata?: any }[];
		edges: { from: string; to: string; confidence: number; methods: string[]; isManual: boolean; metadata?: any }[];
		groups: { name: string; userIds: string[]; metadata?: any }[];
	}> {
		const visited = new Set<string>();
		const allLinks = new Map<string, AccountLink>();
		const nodes = new Map<string, any>();

		const queue = [userId];
		visited.add(userId);

		while (queue.length > 0) {
			const currentUserId = queue.shift()!;
			const links = await this.getAccountLinks(currentUserId);

			for (const link of links) {
				const linkKey = `${link.primaryUserId}-${link.linkedUserId}`;
				allLinks.set(linkKey, link);

				const otherUserId = link.primaryUserId === currentUserId ? link.linkedUserId : link.primaryUserId;

				if (!visited.has(otherUserId)) {
					visited.add(otherUserId);
					queue.push(otherUserId);
				}
			}
		}

		const userIds = Array.from(visited);
		const users = await this.usersRepository.findBy({ id: userIds as any });

		for (const user of users) {
			nodes.set(user.id, {
				id: user.id,
				name: user.username || user.id,
				type: 'user',
				metadata: {
					host: user.host,
				},
			});
		}

		const edges = Array.from(allLinks.values()).map(link => ({
			from: link.primaryUserId,
			to: link.linkedUserId,
			confidence: link.confidence,
			methods: link.detectionMethods,
			isManual: link.isManual,
			metadata: link.metadata,
		}));

		const groups = this.detectGroups(Array.from(allLinks.values()));

		return {
			nodes: Array.from(nodes.values()),
			edges,
			groups,
		};
	}

	private detectGroups(links: AccountLink[]): { name: string; userIds: string[]; metadata?: any }[] {
		const groups: { name: string; userIds: string[]; metadata?: any }[] = [];
		const groupMap = new Map<string, Set<string>>();

		for (const link of links) {
			if (link.metadata?.groupName) {
				if (!groupMap.has(link.metadata.groupName)) {
					groupMap.set(link.metadata.groupName, new Set());
				}
				groupMap.get(link.metadata.groupName)!.add(link.primaryUserId);
				groupMap.get(link.metadata.groupName)!.add(link.linkedUserId);
			}
		}

		for (const [groupName, userIds] of groupMap.entries()) {
			const groupLinks = links.filter(l => l.metadata?.groupName === groupName);
			groups.push({
				name: groupName,
				userIds: Array.from(userIds),
				metadata: {
					description: groupLinks[0]?.metadata?.groupDescription,
					linkCount: groupLinks.length,
					confidence: groupLinks.reduce((sum, l) => sum + l.confidence, 0) / groupLinks.length,
				},
			});
		}

		return groups;
	}

	@bindThis
	public async removeAccountLink(linkId: string): Promise<boolean> {
		const linkData = await this.redisClient.get(`account-link:${linkId}`);
		if (!linkData) return false;

		const link = JSON.parse(linkData) as AccountLink;

		await this.redisClient.del(`account-link:${linkId}`);
		await this.redisClient.srem(`user-links:${link.primaryUserId}`, linkId);
		await this.redisClient.srem(`user-links:${link.linkedUserId}`, linkId);

		return true;
	}

	@bindThis
	public async applyLinkPenalty(baseScore: number, userId: string): Promise<number> {
		const links = await this.getAccountLinks(userId);
		if (links.length === 0) return baseScore;

		let maxPenalty = 1.0;
		for (const link of links) {
			if (!link.expiresAt || link.expiresAt > new Date()) {
				maxPenalty = Math.max(maxPenalty, link.penaltyMultiplier);
			}
		}

		if (baseScore > 65) {
			return baseScore / maxPenalty;
		} else {
			return baseScore * maxPenalty;
		}
	}

	@bindThis
	private calculateCurrentPenalty(link: AccountLink): number {
		if (link.isManual) {
			return link.penaltyMultiplier;
		}

		const now = new Date();
		const elapsed = now.getTime() - link.createdAt.getTime();
		const days = elapsed / (24 * 60 * 60 * 1000);

		const decayed = link.penaltyMultiplier * Math.exp(-this.penaltyConfig.decayRate * days);
		return Math.max(this.penaltyConfig.minMultiplier, decayed);
	}

	private extractSubnets(ips: Set<string>): Set<string> {
		const subnets = new Set<string>();
		for (const ip of ips) {
			const parts = ip.split('.');
			if (parts.length === 4) {
				subnets.add(parts.slice(0, 3).join('.'));
			}
		}
		return subnets;
	}

	private calculateSetSimilarity(set1: Set<string>, set2: Set<string>): number {
		if (set1.size === 0 || set2.size === 0) return 0;
		const intersection = new Set([...set1].filter(x => set2.has(x)));
		const union = new Set([...set1, ...set2]);
		return intersection.size / union.size;
	}

	private extractDeviceFingerprint(headers: any): string {
		const mockRequest = {
			headers: headers || {},
			ip: '',
		} as any;
		return this.generateDeviceFingerprintFromRequest(mockRequest);
	}

	private compareDeviceFingerprints(fp1: string, fp2: string): number {
		return this.compareDeviceFingerprintsFuzzy(fp1, fp2);
	}

	private extractTimePattern(ids: string[]): number[] {
		const hourCounts = new Array(24).fill(0);
		for (const id of ids) {
			const timestamp = this.idService.parse(id);
			hourCounts[timestamp.date.getHours()]++;
		}
		return hourCounts;
	}

	private compareTimePatterns(pattern1: number[], pattern2: number[]): number {
		const correlation = this.calculateCorrelation(pattern1, pattern2);
		return (correlation + 1) / 2;
	}

	private extractFrequencyPattern(ids: string[]): number[] {
		const dailyCounts = new Map<string, number>();
		for (const id of ids) {
			const date = this.idService.parse(id).date;
			const day = date.toISOString().split('T')[0];
			dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
		}
		return Array.from(dailyCounts.values());
	}

	private compareFrequencyPatterns(pattern1: number[], pattern2: number[]): number {
		const mean1 = pattern1.reduce((a, b) => a + b, 0) / pattern1.length;
		const mean2 = pattern2.reduce((a, b) => a + b, 0) / pattern2.length;
		const std1 = Math.sqrt(pattern1.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / pattern1.length);
		const std2 = Math.sqrt(pattern2.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / pattern2.length);

		const meanDiff = Math.abs(mean1 - mean2) / Math.max(mean1, mean2, 1);
		const stdDiff = Math.abs(std1 - std2) / Math.max(std1, std2, 1);

		return 1 - (meanDiff * 0.5 + stdDiff * 0.5);
	}

	private extractLengthDistribution(lengths: number[]): number[] {
		const bins = [0, 50, 100, 200, 500, 1000, Infinity];
		const distribution = new Array(bins.length - 1).fill(0);

		for (const length of lengths) {
			for (let i = 0; i < bins.length - 1; i++) {
				if (length >= bins[i] && length < bins[i + 1]) {
					distribution[i]++;
					break;
				}
			}
		}

		const total = distribution.reduce((a, b) => a + b, 0);
		return distribution.map(d => d / total);
	}

	private compareDistributions(dist1: number[], dist2: number[]): number {
		let similarity = 0;
		for (let i = 0; i < Math.min(dist1.length, dist2.length); i++) {
			similarity += Math.min(dist1[i], dist2[i]);
		}
		return similarity;
	}

	private analyzeWritingStyle(text1: string, text2: string): number {
		const style1 = {
			exclamation: (text1.match(/!/g) || []).length / text1.length,
			question: (text1.match(/\?/g) || []).length / text1.length,
			emoji: (text1.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length / text1.length,
			uppercase: (text1.match(/[A-Z]/g) || []).length / text1.length,
		};

		const style2 = {
			exclamation: (text2.match(/!/g) || []).length / text2.length,
			question: (text2.match(/\?/g) || []).length / text2.length,
			emoji: (text2.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length / text2.length,
			uppercase: (text2.match(/[A-Z]/g) || []).length / text2.length,
		};

		let similarity = 0;
		const keys = Object.keys(style1) as (keyof typeof style1)[];
		for (const key of keys) {
			const diff = Math.abs(style1[key] - style2[key]);
			similarity += 1 - Math.min(1, diff * 10);
		}

		return similarity / keys.length;
	}

	private calculateCorrelation(arr1: number[], arr2: number[]): number {
		const n = Math.min(arr1.length, arr2.length);
		const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
		const mean2 = arr2.reduce((a, b) => a + b, 0) / n;

		let numerator = 0;
		let denominator1 = 0;
		let denominator2 = 0;

		for (let i = 0; i < n; i++) {
			const diff1 = arr1[i] - mean1;
			const diff2 = arr2[i] - mean2;
			numerator += diff1 * diff2;
			denominator1 += diff1 * diff1;
			denominator2 += diff2 * diff2;
		}

		const denominator = Math.sqrt(denominator1 * denominator2);
		return denominator === 0 ? 0 : numerator / denominator;
	}

	@bindThis
	public async trackRequest(userId: string, request: FastifyRequest, endpoint: string): Promise<void> {
		const ip = this.extractRealIp(request);
		const deviceFingerprint = this.generateDeviceFingerprintFromRequest(request);
		const timestamp = new Date();

		const requestData = {
			userId,
			ip,
			deviceFingerprint,
			endpoint,
			timestamp: timestamp.toISOString(),
			headers: {
				'user-agent': request.headers['user-agent'],
				'accept-language': request.headers['accept-language'],
				'accept-encoding': request.headers['accept-encoding'],
			},
		};

		const key = `api-request:${userId}:${timestamp.getTime()}`;
		await this.redisClient.set(key, JSON.stringify(requestData), 'EX', 86400);

		await this.redisClient.zadd(
			`user-requests:${userId}`,
			timestamp.getTime(),
			key,
		);

		const cutoff = timestamp.getTime() - 86400000;
		await this.redisClient.zremrangebyscore(`user-requests:${userId}`, '-inf', cutoff);

		if (ip) {
			await this.userIpsRepository.upsert({
				userId,
				ip,
				createdAt: timestamp,
			}, ['userId', 'ip']);
		}

		const sessionToken = request.headers['authorization']?.replace('Bearer ', '');
		if (sessionToken) {
			const session = await this.userSessionsRepository.findOne({
				where: { token: sessionToken, isActive: true },
			});

			if (session) {
				const ipRecords = session.ip || [];
				const existingIp = ipRecords.find(r => r.address === ip);

				if (existingIp) {
					existingIp.count++;
					existingIp.lastSeen = timestamp;
				} else if (ip) {
					ipRecords.push({ address: ip, count: 1, lastSeen: timestamp });
				}

				await this.userSessionsRepository.update(session.id, {
					lastUsedAt: timestamp,
					ip: ipRecords.slice(0, 10),
				});
			}
		}
	}

	@bindThis
	private extractRealIp(request: FastifyRequest): string {
		const headers = request.headers;

		if (headers['cf-connecting-ip']) {
			return headers['cf-connecting-ip'] as string;
		}

		if (headers['x-real-ip']) {
			return headers['x-real-ip'] as string;
		}

		if (headers['x-forwarded-for']) {
			const forwarded = headers['x-forwarded-for'] as string;
			return forwarded.split(',')[0].trim();
		}

		if (headers['x-client-ip']) {
			return headers['x-client-ip'] as string;
		}

		return request.ip;
	}

	@bindThis
	private generateDeviceFingerprintFromRequest(request: FastifyRequest): string {
		const headers = request.headers;

		const features = {
			core: {
				platform: this.extractPlatformFromUA(headers['user-agent'] as string),
				browser: this.extractBrowserFromUA(headers['user-agent'] as string),
				mobile: this.isMobileUA(headers['user-agent'] as string),
			},
			semiStable: {
				language: headers['accept-language']?.split(',')[0],
				encoding: headers['accept-encoding'],
				dnt: headers['dnt'],
			},
			volatile: {
				accept: headers['accept'],
				cacheControl: headers['cache-control'],
			},
			clientHints: {
				platform: headers['sec-ch-ua-platform'],
				mobile: headers['sec-ch-ua-mobile'],
				arch: headers['sec-ch-ua-arch'],
				model: headers['sec-ch-ua-model'],
			},
		};

		const coreHash = crypto.createHash('sha256')
			.update(JSON.stringify(features.core))
			.digest('hex').substring(0, 16);

		const semiStableHash = crypto.createHash('sha256')
			.update(JSON.stringify(features.semiStable))
			.digest('hex').substring(0, 8);

		const volatileHash = crypto.createHash('sha256')
			.update(JSON.stringify(features.volatile))
			.digest('hex').substring(0, 4);

		return `${coreHash}-${semiStableHash}-${volatileHash}`;
	}

	@bindThis
	public compareDeviceFingerprintsFuzzy(fp1: string, fp2: string): number {
		if (fp1 === fp2) return 1.0;

		const parts1 = fp1.split('-');
		const parts2 = fp2.split('-');

		if (parts1.length !== 3 || parts2.length !== 3) {
			return fp1 === fp2 ? 1 : 0;
		}

		let score = 0;

		if (parts1[0] === parts2[0]) score += 0.6;

		if (parts1[1] === parts2[1]) score += 0.3;

		if (parts1[2] === parts2[2]) score += 0.1;

		return score;
	}

	private extractPlatformFromUA(ua: string | undefined): string {
		if (!ua) return 'unknown';

		if (ua.includes('Windows NT')) return 'windows';
		if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macos';
		if (ua.includes('Linux')) return 'linux';
		if (ua.includes('Android')) return 'android';
		if (ua.includes('iPhone') || ua.includes('iPad')) return 'ios';

		return 'other';
	}

	private extractBrowserFromUA(ua: string | undefined): string {
		if (!ua) return 'unknown';

		if (ua.includes('Edg/')) return 'edge';
		if (ua.includes('OPR/') || ua.includes('Opera')) return 'opera';
		if (ua.includes('Chrome/')) return 'chrome';
		if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'safari';
		if (ua.includes('Firefox/')) return 'firefox';

		return 'other';
	}

	private isMobileUA(ua: string | undefined): boolean {
		if (!ua) return false;

		const mobileKeywords = [
			'Mobile', 'Android', 'iPhone', 'iPad', 'iPod',
			'BlackBerry', 'IEMobile', 'Opera Mini', 'Windows Phone',
		];

		return mobileKeywords.some(keyword => ua.includes(keyword));
	}

	@bindThis
	public async analyzeRequestPatternRisk(userId: string): Promise<{
		riskScore: number;
		factors: string[];
	}> {
		const now = Date.now();
		const oneHourAgo = now - 3600000;
		const oneDayAgo = now - 86400000;

		const recentKeys = await this.redisClient.zrangebyscore(
			`user-requests:${userId}`,
			oneDayAgo,
			now,
		);

		if (recentKeys.length === 0) {
			return { riskScore: 0, factors: [] };
		}

		const requests = [];
		for (const key of recentKeys) {
			const data = await this.redisClient.get(key);
			if (data) {
				requests.push(JSON.parse(data));
			}
		}

		let riskScore = 0;
		const factors = [];

		const hourlyRequests = requests.filter(r =>
			new Date(r.timestamp).getTime() > oneHourAgo
		).length;

		if (hourlyRequests > 100) {
			riskScore += 20;
			factors.push(`High request frequency: ${hourlyRequests}/hour`);
		}

		const uniqueIps = new Set(requests.map(r => r.ip).filter(Boolean));
		if (uniqueIps.size > 5) {
			riskScore += 15;
			factors.push(`Frequent IP changes: ${uniqueIps.size} different IPs`);
		}

		const uniqueDevices = new Set(requests.map(r => r.deviceFingerprint));
		if (uniqueDevices.size > 3) {
			riskScore += 10;
			factors.push(`Multiple device access: ${uniqueDevices.size} devices`);
		}

		const endpoints = requests.map(r => r.endpoint);
		const endpointCounts = new Map<string, number>();
		for (const endpoint of endpoints) {
			endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + 1);
		}

		for (const [endpoint, count] of endpointCounts) {
			if (count > 50 && endpoint.includes('follow')) {
				riskScore += 25;
				factors.push(`Mass follow activity: ${count} times`);
			}
			if (count > 100 && endpoint.includes('note')) {
				riskScore += 20;
				factors.push(`Mass posting: ${count} times`);
			}
		}

		return { riskScore: Math.min(100, riskScore), factors };
	}

	@bindThis
	private calculateBayesianConfidence(methods: string[], evidence: Record<string, any>): number {
		const priorProbability = 0.05;

		const methodReliability = {
			ip_overlap: 0.85,
			device_fingerprint: 0.90,
			behavior_pattern: 0.70,
			content_similarity: 0.75,
			timing_correlation: 0.80,
			social_graph: 0.65,
		};

		const independenceFactor = {
			ip_overlap: 0.9,
			device_fingerprint: 0.85,
			behavior_pattern: 0.8,
			content_similarity: 0.7,
			timing_correlation: 0.75,
			social_graph: 0.85,
		};

		if (methods.length === 0) {
			return 0;
		}

		let combinedLikelihoodRatio = 1.0;
		let totalWeight = 0;

		for (const method of methods) {
			const reliability = methodReliability[method as keyof typeof methodReliability] || 0.5;
			const independence = independenceFactor[method as keyof typeof independenceFactor] || 0.8;
			const evidenceValue = evidence[method.replace('_', '')] || evidence[method] || 0.5;

			const likelihoodGivenLinked = reliability * evidenceValue + (1 - reliability) * 0.5;

			const likelihoodGivenNotLinked = (1 - reliability) * evidenceValue + reliability * 0.1;

			const likelihoodRatio = likelihoodGivenLinked / (likelihoodGivenNotLinked + 0.001);

			const weight = independence * reliability;

			combinedLikelihoodRatio *= Math.pow(likelihoodRatio, weight);
			totalWeight += weight;
		}

		if (totalWeight > 0) {
			combinedLikelihoodRatio = Math.pow(combinedLikelihoodRatio, 1 / totalWeight);
		}

		const posteriorOdds = (priorProbability / (1 - priorProbability)) * combinedLikelihoodRatio;
		const posteriorProbability = posteriorOdds / (1 + posteriorOdds);

		let penalty = 1.0;

		if (methods.length > 3) {
			penalty *= 1.1;
		}

		const hasHighTechMethods = methods.some(m => ['device_fingerprint', 'ip_overlap'].includes(m));
		const hasBehaviorMethods = methods.some(m => ['behavior_pattern', 'content_similarity'].includes(m));

		if (hasHighTechMethods && hasBehaviorMethods) {
			penalty *= 1.15;
		}

		const finalProbability = Math.min(0.95, posteriorProbability * penalty);

		return Math.max(0, finalProbability);
	}

	@bindThis
	public async getLinkedAccountIds(userId: string): Promise<string[]> {
		const links = await this.getAccountLinks(userId);
		const linkedIds = new Set<string>([userId]);

		for (const link of links) {
			linkedIds.add(link.primaryUserId);
			linkedIds.add(link.linkedUserId);
		}

		return Array.from(linkedIds);
	}

	@bindThis
	public async syncInitialScores(userId1: string, userId2: string): Promise<void> {
		try {
			const [user1, user2] = await Promise.all([
				this.usersRepository.findOneBy({ id: userId1 }),
				this.usersRepository.findOneBy({ id: userId2 })
			]);

			if (!user1 || !user2) {
				console.warn(`Cannot sync scores for non-existent users: ${userId1}, ${userId2}`);
				return;
			}

			const score1 = user1.riskScore || 60;
			const score2 = user2.riskScore || 60;
			const calculatedSync = Math.round((score1 + score2) / 3);

			const minOriginalScore = Math.min(score1, score2);
			const syncedScore = Math.max(calculatedSync, minOriginalScore);

			const [linkedIds1, linkedIds2] = await Promise.all([
				this.getLinkedAccountIds(userId1),
				this.getLinkedAccountIds(userId2)
			]);

			const allLinkedIds = Array.from(new Set([...linkedIds1, ...linkedIds2]));

			const updatePromises = allLinkedIds.map(async (linkedId) => {
				await this.usersRepository.update(linkedId, {
					riskScore: syncedScore,
					riskScoreUpdatedAt: new Date(),
				});

				await this.redisClient.del(`user:risk-score:${linkedId}`);
			});

			await Promise.all(updatePromises);

			console.log(`Initial score sync completed for ${allLinkedIds.length} linked accounts with score ${syncedScore}`);
		} catch (error) {
			console.error('Error syncing initial scores:', error);
		}
	}

	@bindThis
	public async syncAccountScores(userId: string, newScore: number): Promise<void> {
		try {
			const linkedIds = await this.getLinkedAccountIds(userId);

			if (linkedIds.length <= 1) {
				return;
			}

			const updatePromises = linkedIds.map(async (linkedId) => {
				if (linkedId !== userId) {
					await this.usersRepository.update(linkedId, {
						riskScore: newScore,
						riskScoreUpdatedAt: new Date(),
					});

					await this.redisClient.del(`user:risk-score:${linkedId}`);
				}
			});

			await Promise.all(updatePromises);

			console.log(`Score sync completed for ${linkedIds.length} linked accounts with score ${newScore}`);
		} catch (error) {
			console.error('Error syncing account scores:', error);
		}
	}

	@bindThis
	public async syncMultiAccountScores(userIds: string[]): Promise<void> {
		try {
			const users = await this.usersRepository.findBy({ id: userIds as any });

			if (users.length !== userIds.length) {
				console.warn(`Cannot sync scores: some users not found in ${userIds.join(', ')}`);
				return;
			}

			const totalScore = users.reduce((sum, user) => sum + (user.riskScore || 60), 0);
			const syncedScore = Math.round(totalScore / (users.length + 2));

			const updatePromises = userIds.map(async (userId) => {
				await this.usersRepository.update(userId, {
					riskScore: syncedScore,
					riskScoreUpdatedAt: new Date(),
				});

				await this.redisClient.del(`user:risk-score:${userId}`);
			});

			await Promise.all(updatePromises);

			console.log(`Multi-account score sync completed for ${userIds.length} accounts with score ${syncedScore}`);
		} catch (error) {
			console.error('Error syncing multi-account scores:', error);
		}
	}

	@bindThis
	public async onUserRiskScoreUpdate(userId: string, newScore: number): Promise<void> {
		const links = await this.getAccountLinks(userId);
		if (links.length > 0) {
			await this.syncAccountScores(userId, newScore);
		}
	}
}
