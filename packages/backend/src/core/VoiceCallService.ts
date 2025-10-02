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

type VoiceCallMode = 'auto' | 'p2p' | 'sfu';

interface VoiceCallSession {
	callId: string;
	callerId: MiUser['id'];
	recipientId: MiUser['id'];
	callerSessionId?: string;
	recipientSessionId?: string;
	notificationId?: string;
	status: 'ringing' | 'connecting' | 'connected' | 'ended';
	mode: VoiceCallMode;
	currentMode: 'p2p' | 'sfu';
	createdAt: number;
	connectedAt?: number;
	appId?: string;
	appSecret?: string;
	callerPushed?: boolean;
	recipientPushed?: boolean;
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
		mode: VoiceCallMode = 'auto',
	): Promise<{ callId: string; iceServers: RTCIceServer[]; mode: VoiceCallMode; currentMode: 'p2p' | 'sfu'; sessionId?: string } | null> {
		if (callerId === recipientId) {
			return null;
		}

		const callId = this.idService.gen();

		let currentMode: 'p2p' | 'sfu';
		let appId: string | undefined;
		let appSecret: string | undefined;
		let callerSessionId: string | undefined;

		if (mode === 'sfu') {
			currentMode = 'sfu';
			if (!this.isEnabled()) {
				return null;
			}
			const appCreds = await this.cloudflareCallsService.getAppCredentials();
			if (!appCreds) {
				return null;
			}
			const session = await this.cloudflareCallsService.createSession(appCreds.appId, appCreds.appSecret);
			if (!session) {
				return null;
			}
			appId = appCreds.appId;
			appSecret = appCreds.appSecret;
			callerSessionId = session.sessionId;
		} else {
			currentMode = 'p2p';
		}

		const voiceSession: VoiceCallSession = {
			callId,
			callerId,
			recipientId,
			status: 'ringing',
			mode,
			currentMode,
			createdAt: Date.now(),
			appId,
			appSecret,
			callerSessionId,
		};

		this.notificationService.createNotification(recipientId, 'voiceCall', {}, callerId);

		await this.setSession(voiceSession);

		this.globalEventService.publishMainStream(recipientId, 'voiceCall', {
			type: 'incoming',
			callId,
			from: callerId,
			mode,
		});

		return {
			callId,
			iceServers: currentMode === 'p2p' ? this.cloudflareCallsService.getIceServers() : [],
			mode,
			currentMode,
			sessionId: callerSessionId,
		};
	}

	@bindThis
	public async answerCall(callId: string, userId: MiUser['id']): Promise<{ iceServers: RTCIceServer[]; mode: VoiceCallMode; currentMode: 'p2p' | 'sfu'; sessionId?: string } | null> {
		const session = await this.getSession(callId);
		if (!session || session.recipientId !== userId) {
			return null;
		}

		let recipientSessionId: string | undefined;
		if (session.currentMode === 'sfu') {
			if (!session.appId || !session.appSecret) {
				return null;
			}
			const recipientSession = await this.cloudflareCallsService.createSession(session.appId, session.appSecret);
			if (!recipientSession) {
				return null;
			}
			recipientSessionId = recipientSession.sessionId;
			session.recipientSessionId = recipientSessionId;
		}

		session.status = 'connecting';
		await this.setSession(session);

		this.globalEventService.publishMainStream(session.callerId, 'voiceCall', {
			type: 'answered',
			callId,
			by: userId,
		});

		return {
			iceServers: session.currentMode === 'p2p' ? this.cloudflareCallsService.getIceServers() : [],
			mode: session.mode,
			currentMode: session.currentMode,
			sessionId: recipientSessionId,
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
	public async pushTracks(
		callId: string,
		userId: MiUser['id'],
		offer: RTCSessionDescriptionInit,
		tracks: Array<{ mid: string; trackName: string }>,
	): Promise<{ answer: RTCSessionDescriptionInit } | null> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return null;
		}

		if (!session.appId || !session.appSecret) {
			return null;
		}

		const userSessionId = userId === session.callerId ? session.callerSessionId : session.recipientSessionId;
		if (!userSessionId) {
			return null;
		}

		const result = await this.cloudflareCallsService.addTrack(
			session.appId,
			session.appSecret,
			userSessionId,
			offer,
			tracks.map(t => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
		);

		if (!result) {
			return null;
		}

		await this.setSession(session);

		return {
			answer: result.sessionDescription,
		};
	}

	@bindThis
	public async markTracksReady(callId: string, userId: MiUser['id']): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return;
		}

		const isCaller = userId === session.callerId;
		if (isCaller) {
			session.callerPushed = true;
		} else {
			session.recipientPushed = true;
		}
		await this.setSession(session);

		const otherUserId = isCaller ? session.recipientId : session.callerId;
		const otherPushed = isCaller ? session.recipientPushed : session.callerPushed;

		if (otherPushed) {
			this.globalEventService.publishMainStream(otherUserId, 'voiceCall', {
				type: 'readyToPull',
				callId,
			});
			this.globalEventService.publishMainStream(userId, 'voiceCall', {
				type: 'readyToPull',
				callId,
			});
		}
	}

	@bindThis
	public async pullTracks(
		callId: string,
		userId: MiUser['id'],
		offer: RTCSessionDescriptionInit,
	): Promise<{ answer: RTCSessionDescriptionInit } | null> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return null;
		}

		if (!session.appId || !session.appSecret) {
			return null;
		}

		const userSessionId = userId === session.callerId ? session.callerSessionId : session.recipientSessionId;
		const otherSessionId = userId === session.callerId ? session.recipientSessionId : session.callerSessionId;

		if (!userSessionId || !otherSessionId) {
			return null;
		}

		const isCaller = userId === session.callerId;
		let currentSession = session;
		let otherPushed = isCaller ? currentSession.recipientPushed : currentSession.callerPushed;

		for (let waitAttempt = 0; waitAttempt < 20 && !otherPushed; waitAttempt++) {
			if (waitAttempt > 0) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			currentSession = await this.getSession(callId) ?? currentSession;
			otherPushed = isCaller ? currentSession.recipientPushed : currentSession.callerPushed;
		}

		if (!otherPushed) {
			return null;
		}

		await new Promise(resolve => setTimeout(resolve, 3000));

		const result = await this.cloudflareCallsService.addTrack(
			currentSession.appId!,
			currentSession.appSecret!,
			userSessionId,
			offer,
			[{ location: 'remote', trackName: 'audio', sessionId: otherSessionId }],
		);

		if (!result) {
			return null;
		}

		if (currentSession.status === 'connecting') {
			currentSession.status = 'connected';
			currentSession.connectedAt = Date.now();
			await this.setSession(currentSession);
		}

		return {
			answer: result.sessionDescription,
		};
	}

	@bindThis
	public async answerPull(
		callId: string,
		userId: MiUser['id'],
		answer: RTCSessionDescriptionInit,
	): Promise<boolean> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return false;
		}

		if (!session.appId || !session.appSecret) {
			return false;
		}

		const userSessionId = userId === session.callerId ? session.callerSessionId : session.recipientSessionId;
		if (!userSessionId) {
			return false;
		}

		const result = await this.cloudflareCallsService.renegotiateSession(
			session.appId,
			session.appSecret,
			userSessionId,
			answer,
		);

		if (result && session.status === 'connecting') {
			session.status = 'connected';
			session.connectedAt = Date.now();
			await this.setSession(session);
		}

		return !!result;
	}

	@bindThis
	public async relaySignaling(
		callId: string,
		userId: MiUser['id'],
		signalType: 'iceCandidate' | 'offer' | 'answer',
		signalData: any,
	): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return;
		}

		if (session.currentMode !== 'p2p') {
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
	}

	/**
	 * Switch call from P2P to SFU mode (only allowed in 'auto' mode)
	 * Called when P2P connection fails or times out
	 */
	@bindThis
	public async switchToSfu(callId: string, userId: MiUser['id']): Promise<{ sessionId: string } | null> {
		if (!this.isEnabled()) {
			return null;
		}

		const session = await this.getSession(callId);
		if (!session || (session.callerId !== userId && session.recipientId !== userId)) {
			return null;
		}

		if (session.mode !== 'auto') {
			return null;
		}

		if (session.currentMode === 'sfu') {
			return null;
		}

		if (!session.appId || !session.appSecret) {
			const appCreds = await this.cloudflareCallsService.getAppCredentials();
			if (!appCreds) {
				return null;
			}
			session.appId = appCreds.appId;
			session.appSecret = appCreds.appSecret;
		}

		const userSession = await this.cloudflareCallsService.createSession(session.appId, session.appSecret);
		if (!userSession) {
			return null;
		}

		const isCaller = userId === session.callerId;
		if (isCaller) {
			session.callerSessionId = userSession.sessionId;
		} else {
			session.recipientSessionId = userSession.sessionId;
		}

		session.currentMode = 'sfu';
		await this.setSession(session);

		const otherUserId = isCaller ? session.recipientId : session.callerId;
		this.globalEventService.publishMainStream(otherUserId, 'voiceCall', {
			type: 'switchToSfu',
			callId,
		});

		return {
			sessionId: userSession.sessionId,
		};
	}
}
