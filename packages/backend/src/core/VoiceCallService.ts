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
import type { RTCIceServer, RTCSessionDescriptionInit } from '@/core/webrtc-types.js';

type VoiceCallMode = 'auto' | 'p2p' | 'sfu';
type VoiceCallType = 'p2p' | 'group';

interface VoiceCallSession {
	callId: string;

	type?: VoiceCallType;

	callerId: MiUser['id'];
	recipientId: MiUser['id'];
	callerSessionId?: string;
	recipientSessionId?: string;
	notificationId?: string;
	answeredBy?: MiUser['id'];

	groupId?: string;
	participants?: string[];
	participantSessions?: Record<string, string>;
	participantTracks?: Record<string, { mid: string; trackName: string }>;

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

function isP2PCall(session: VoiceCallSession): boolean {
	return !session.type || session.type === 'p2p';
}

function isGroupCall(session: VoiceCallSession): boolean {
	return session.type === 'group';
}

@Injectable()
export class VoiceCallService {
	private readonly GET_OR_SET_GROUP_CALL_SCRIPT = `
		local existing = redis.call('GET', KEYS[1])
		if existing then
			return existing
		end
		redis.call('SETEX', KEYS[1], ARGV[1], ARGV[2])
		return ARGV[2]
	`;

	private readonly ADD_PARTICIPANT_SCRIPT = `
		local sessionKey = KEYS[1]
		local userId = ARGV[1]
		local cloudflareSessionId = ARGV[2]
		local ttl = tonumber(ARGV[3])

		local sessionData = redis.call('GET', sessionKey)
		if not sessionData then
			return nil
		end

		-- cjson is globally available in Redis, no require needed
		local session = cjson.decode(sessionData)

		-- Add to participants if not already present
		local found = false
		if session.participants then
			for i, id in ipairs(session.participants) do
				if id == userId then
					found = true
					break
				end
			end
		else
			session.participants = {}
		end

		if not found then
			table.insert(session.participants, userId)
		end

		-- Add to participantSessions
		if not session.participantSessions then
			session.participantSessions = {}
		end
		session.participantSessions[userId] = cloudflareSessionId

		-- Write back with TTL
		local newSessionData = cjson.encode(session)
		redis.call('SETEX', sessionKey, ttl, newSessionData)

		return newSessionData
	`;

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
	private async getUserActiveCall(userId: MiUser['id']): Promise<string | null> {
		return await this.redisClient.get(`voicecall:user:${userId}`);
	}

	@bindThis
	private async setUserActiveCall(userId: MiUser['id'], callId: string): Promise<void> {
		await this.redisClient.setex(`voicecall:user:${userId}`, 3600, callId);
	}

	@bindThis
	private async deleteUserActiveCall(userId: MiUser['id']): Promise<void> {
		await this.redisClient.del(`voicecall:user:${userId}`);
	}

	@bindThis
	public async getCurrentCall(userId: MiUser['id']): Promise<VoiceCallSession | null> {
		const callId = await this.getUserActiveCall(userId);
		if (!callId) return null;

		const session = await this.getSession(callId);
		if (!session || session.status === 'ended') {
			await this.deleteUserActiveCall(userId);
			return null;
		}

		return session;
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

		const callerActiveCall = await this.getUserActiveCall(callerId);
		if (callerActiveCall) {
			return null;
		}

		const recipientActiveCall = await this.getUserActiveCall(recipientId);
		if (recipientActiveCall) {
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
		await this.setUserActiveCall(callerId, callId);
		await this.setUserActiveCall(recipientId, callId);

		this.globalEventService.publishMainStream(recipientId, 'voiceCall', {
			type: 'incoming',
			callId,
			from: callerId,
			mode,
			currentMode,
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

		if (session.answeredBy && session.answeredBy !== userId) {
			return null;
		}

		if (!session.answeredBy) {
			session.answeredBy = userId;
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
		await this.deleteUserActiveCall(session.callerId);
		await this.deleteUserActiveCall(session.recipientId);
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
		await this.deleteUserActiveCall(session.callerId);
		await this.deleteUserActiveCall(session.recipientId);
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

	/**
	 * Create a group voice call
	 * Unlike p2p calls, group calls start in 'connected' status immediately
	 * Uses atomic Lua script to prevent race conditions when multiple users join simultaneously
	 */
	@bindThis
	public async createGroupCall(
		groupId: string,
		initiatorId: MiUser['id'],
		mode: VoiceCallMode = 'sfu',
	): Promise<{ callId: string; iceServers: RTCIceServer[] } | null> {
		if (!this.isEnabled()) {
			return null;
		}

		const appCreds = await this.cloudflareCallsService.getAppCredentials();
		if (!appCreds) {
			return null;
		}

		const candidateCallId = this.idService.gen();

		const actualCallId = await this.redisClient.eval(
			this.GET_OR_SET_GROUP_CALL_SCRIPT,
			1,
			`voicecall:group:${groupId}`,
			3600,
			candidateCallId,
		) as string;

		if (actualCallId !== candidateCallId) {
			const existingSession = await this.getSession(actualCallId);
			if (existingSession && existingSession.status !== 'ended') {
				return {
					callId: actualCallId,
					iceServers: mode === 'sfu' ? [] : this.cloudflareCallsService.getIceServers(),
				};
			}
		}

		const groupSession: VoiceCallSession = {
			callId: actualCallId,
			type: 'group',
			groupId,
			callerId: initiatorId,
			recipientId: initiatorId,
			participants: [],
			participantSessions: {},
			status: 'connected',
			mode,
			currentMode: 'sfu',
			createdAt: Date.now(),
			connectedAt: Date.now(),
			appId: appCreds.appId,
			appSecret: appCreds.appSecret,
		};

		await this.setSession(groupSession);

		return {
			callId: actualCallId,
			iceServers: mode === 'sfu' ? [] : this.cloudflareCallsService.getIceServers(),
		};
	}

	/**
	 * NEW: Join a group voice call
	 * Creates a Cloudflare session for the user and adds them to participants
	 * @param groupIdOrCallId - Either the groupId (gameId) or the callId
	 * @param userId
	 */
	@bindThis
	public async joinGroupCall(
		groupIdOrCallId: string,
		userId: MiUser['id'],
	): Promise<{ sessionId: string; otherSessions: Record<string, string> } | null> {
		let callId = groupIdOrCallId;
		const resolvedCallId = await this.redisClient.get(`voicecall:group:${groupIdOrCallId}`);
		if (resolvedCallId) {
			callId = resolvedCallId;
		}

		let session = await this.getSession(callId);

		if (!session || !isGroupCall(session)) {
			console.log('[VoiceCall] Group call not found, creating it:', groupIdOrCallId);
			const created = await this.createGroupCall(groupIdOrCallId, userId, 'sfu');
			if (!created) {
				console.error('[VoiceCall] Failed to create group call:', groupIdOrCallId);
				return null;
			}
			callId = created.callId;
			session = await this.getSession(callId);
			if (!session || !isGroupCall(session)) {
				console.error('[VoiceCall] Failed to retrieve created session:', callId);
				return null;
			}
		}

		if (session.status === 'ended') {
			return null;
		}

		const userSession = await this.cloudflareCallsService.createSession(
			session.appId!,
			session.appSecret!,
		);
		if (!userSession) {
			return null;
		}

		const updatedSessionData = await this.redisClient.eval(
			this.ADD_PARTICIPANT_SCRIPT,
			1,
			`voicecall:${callId}`,
			userId,
			userSession.sessionId,
			3600,
		) as string | null;

		if (!updatedSessionData) {
			console.error('[VoiceCall] Failed to add participant atomically:', userId, 'to call:', callId);
			return null;
		}

		const updatedSession: VoiceCallSession = JSON.parse(updatedSessionData);

		await this.setUserActiveCall(userId, callId);

		const otherSessions: Record<string, string> = {};
		for (const [uid, sid] of Object.entries(updatedSession.participantSessions || {})) {
			if (uid !== userId) {
				otherSessions[uid] = sid;
			}
		}

		for (const participantId of updatedSession.participants || []) {
			if (participantId !== userId) {
				this.globalEventService.publishMainStream(participantId, 'voiceCall', {
					type: 'groupMemberJoined',
					callId,
					userId,
				});
			}
		}

		return {
			sessionId: userSession.sessionId,
			otherSessions,
		};
	}

	/**
	 * NEW: Leave a group voice call
	 * Removes user from participants and ends call if empty
	 */
	@bindThis
	public async leaveGroupCall(callId: string, userId: MiUser['id']): Promise<void> {
		const session = await this.getSession(callId);
		if (!session || !isGroupCall(session)) {
			return;
		}

		if (session.participants) {
			session.participants = session.participants.filter(id => id !== userId);
		}
		if (session.participantSessions) {
			delete session.participantSessions[userId];
		}

		await this.deleteUserActiveCall(userId);

		if (!session.participants || session.participants.length === 0) {
			session.status = 'ended';
			if (session.groupId) {
				await this.redisClient.del(`voicecall:group:${session.groupId}`);
			}
			await this.deleteSession(callId);
		} else {
			await this.setSession(session);

			for (const participantId of session.participants) {
				this.globalEventService.publishMainStream(participantId, 'voiceCall', {
					type: 'groupMemberLeft',
					callId,
					userId,
				});
			}
		}
	}

	/**
	 * NEW: Negotiate tracks for group call (simplified, one-step process)
	 * Adds local track and pulls all remote tracks in a single negotiation
	 * @param groupIdOrCallId - Either the groupId (gameId) or the callId
	 * @param userId
	 * @param offer
	 * @param localTrack
	 */
	@bindThis
	public async negotiateGroupTracks(
		groupIdOrCallId: string,
		userId: MiUser['id'],
		offer: RTCSessionDescriptionInit,
		localTrack?: { mid: string; trackName: string },
	): Promise<{ answer: RTCSessionDescriptionInit } | null> {
		let callId = groupIdOrCallId;
		const resolvedCallId = await this.redisClient.get(`voicecall:group:${groupIdOrCallId}`);
		if (resolvedCallId) {
			callId = resolvedCallId;
		}

		const session = await this.getSession(callId);
		if (!session || !isGroupCall(session)) {
			console.error('[VoiceCall] Failed to find group call session for negotiate:', { groupIdOrCallId, resolvedCallId: callId });
			return null;
		}

		if (!session.participants?.includes(userId)) {
			return null;
		}

		const userSessionId = session.participantSessions?.[userId];
		if (!userSessionId) {
			return null;
		}

		const tracks: Array<{ location: 'local' | 'remote'; trackName: string; sessionId?: string; mid?: string }> = [];

		if (localTrack) {
			tracks.push({
				location: 'local',
				mid: localTrack.mid,
				trackName: localTrack.trackName,
			});
		} else {
			for (const [otherUserId, otherSessionId] of Object.entries(session.participantSessions || {})) {
				if (otherUserId !== userId) {
					tracks.push({
						location: 'remote',
						trackName: `audio-${otherUserId}`,
						sessionId: otherSessionId,
					});
				}
			}
		}

		if (tracks.length === 0) {
			return {
				answer: offer,
			};
		}

		const maxRetries = 5;
		const retryDelayMs = 2000;
		let result = null;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			if (attempt > 0) {
				await new Promise(resolve => setTimeout(resolve, retryDelayMs));
			}

			result = await this.cloudflareCallsService.addTrack(
				session.appId!,
				session.appSecret!,
				userSessionId,
				offer,
				tracks,
			);

			if (!result) {
				console.error('[VoiceCall] Fatal error in addTrack, aborting');
				return null;
			}

			if (!result.hasErrors) {
				return {
					answer: result.sessionDescription,
				};
			}

			if (result.hasRetryableTrackError) {
				continue;
			}

			console.error('[VoiceCall] Non-retryable error in addTrack:', result.tracks);
			return null;
		}

		console.error('[VoiceCall] Exhausted all retry attempts for user:', userId);
		return null;
	}
}
