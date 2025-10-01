/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { CloudflareCallsService } from '@/core/CloudflareCallsService.js';
import { NotificationService } from '@/core/NotificationService.js';
import type { MiMeta, MiUser } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';

interface VoiceCallSession {
	callId: string;
	callerId: MiUser['id'];
	recipientId: MiUser['id'];
	callerSessionId?: string;
	recipientSessionId?: string;
	notificationId?: string;
	status: 'ringing' | 'connecting' | 'connected' | 'ended';
	createdAt: number;
	connectedAt?: number;
	appId?: string;
	appSecret?: string;
}

@Injectable()
export class VoiceCallService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.meta)
		private meta: MiMeta,

		private globalEventService: GlobalEventService,
		private cloudflareCallsService: CloudflareCallsService,
		private notificationService: NotificationService,
		private idService: IdService,
	) {}

	@bindThis
	public isEnabled(): boolean {
		if (!this.meta.enableCloudflareSfu) return false;

		const hasAppCredentials = this.meta.cloudflareSfuAppId != null && this.meta.cloudflareSfuAppSecret != null;

		const hasAccountCredentials = this.meta.cloudflareAccountId != null && this.meta.cloudflareApiToken != null;

		return hasAppCredentials || hasAccountCredentials;
	}

	@bindThis
	private async getSession(callId: string): Promise<VoiceCallSession | null> {
		const data = await this.redisClient.get(`voicecall:${callId}`);
		return data ? JSON.parse(data) : null;
	}

	@bindThis
	private async setSession(session: VoiceCallSession): Promise<void> {
		await this.redisClient.setex(
			`voicecall:${session.callId}`,
			3600,
			JSON.stringify(session),
		);
	}

	@bindThis
	private async deleteSession(callId: string): Promise<void> {
		await this.redisClient.del(`voicecall:${callId}`);
	}

	@bindThis
	public async initiateCall(
		callerId: MiUser['id'],
		recipientId: MiUser['id'],
	): Promise<{ callId: string; iceServers: RTCIceServer[]; callerSessionId?: string; sessionDescription?: RTCSessionDescriptionInit } | null> {
		if (!this.isEnabled()) {
			return null;
		}

		if (callerId === recipientId) {
			return null;
		}

		const callId = this.idService.gen();

		const appCreds = await this.cloudflareCallsService.getAppCredentials();

		let callerSessionId: string | undefined;
		let sessionDescription: RTCSessionDescriptionInit | undefined;
		if (appCreds) {
			const callerSession = await this.cloudflareCallsService.createSession(appCreds.appId, appCreds.appSecret);
			if (callerSession) {
				callerSessionId = callerSession.sessionId;
				sessionDescription = callerSession.sessionDescription;
			}
		}

		const session: VoiceCallSession = {
			callId,
			callerId,
			recipientId,
			status: 'ringing',
			createdAt: Date.now(),
			appId: appCreds?.appId,
			appSecret: appCreds?.appSecret,
			callerSessionId,
		};

		this.notificationService.createNotification(recipientId, 'voiceCall', {}, callerId);

		await this.setSession(session);

		this.globalEventService.publishMainStream(recipientId, 'voiceCall', {
			type: 'incoming',
			callId,
			from: callerId,
		});

		return {
			callId,
			iceServers: this.cloudflareCallsService.getIceServers(),
			callerSessionId,
			sessionDescription,
		};
	}

	@bindThis
	public async answerCall(callId: string, userId: MiUser['id']): Promise<{ iceServers: RTCIceServer[]; recipientSessionId?: string; sessionDescription?: RTCSessionDescriptionInit } | null> {
		const session = await this.getSession(callId);
		if (!session || session.recipientId !== userId) {
			return null;
		}

		let recipientSessionId: string | undefined;
		let sessionDescription: RTCSessionDescriptionInit | undefined;
		if (session.appId && session.appSecret) {
			const recipientSession = await this.cloudflareCallsService.createSession(session.appId, session.appSecret);
			if (recipientSession) {
				recipientSessionId = recipientSession.sessionId;
				sessionDescription = recipientSession.sessionDescription;
				session.recipientSessionId = recipientSessionId;
			}
		}

		session.status = 'connecting';
		await this.setSession(session);

		this.globalEventService.publishMainStream(session.callerId, 'voiceCall', {
			type: 'answered',
			callId,
			by: userId,
		});

		return {
			iceServers: this.cloudflareCallsService.getIceServers(),
			recipientSessionId,
			sessionDescription,
		};
	}

	@bindThis
	public async rejectCall(callId: string, userId: MiUser['id']): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || session.recipientId !== userId) {
			return;
		}

		this.globalEventService.publishMainStream(session.callerId, 'voiceCall', {
			type: 'rejected',
			callId,
			by: userId,
		});

		await this.deleteSession(callId);
	}

	@bindThis
	public async endCall(callId: string, userId: MiUser['id']): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return;
		}

		const otherUserId = session.callerId === userId ? session.recipientId : session.callerId;

		if (session.connectedAt && session.status === 'connected') {
			const duration = Math.floor((Date.now() - session.connectedAt) / 1000);

			this.notificationService.createNotification(session.callerId, 'voiceCallEnded', { duration }, session.recipientId);
			this.notificationService.createNotification(session.recipientId, 'voiceCallEnded', { duration }, session.callerId);
		}

		this.globalEventService.publishMainStream(otherUserId, 'voiceCall', {
			type: 'ended',
			callId,
			by: userId,
		});

		await this.deleteSession(callId);
	}

	@bindThis
	public async relaySignaling(
		callId: string,
		userId: MiUser['id'],
		signalType: 'offer' | 'answer' | 'iceCandidate',
		signalData: any,
	): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return;
		}

		const recipientId = session.callerId === userId ? session.recipientId : session.callerId;

		this.globalEventService.publishMainStream(recipientId, 'voiceCall', {
			type: 'signal',
			callId,
			signalType,
			signalData,
			from: userId,
		});

		if (signalType === 'answer' && session.status === 'connecting') {
			session.status = 'connected';
			session.connectedAt = Date.now();
			await this.setSession(session);
		}
	}
}
