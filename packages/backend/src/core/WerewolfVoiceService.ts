/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type { MiWerewolfGame } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { CloudflareCallsService } from '@/core/CloudflareCallsService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import type { RTCSessionDescriptionInit } from '@/core/webrtc-types.js';

interface ParticipantVoiceState {
	sessionId: string;
	trackId?: string;
	trackName: string;
	connectedAt: Date;
}

interface WerewolfVoiceSession {
	gameId: MiWerewolfGame['id'];
	appId: string;
	appSecret: string;
	participants: Record<MiUser['id'], ParticipantVoiceState>;
	createdAt: Date;
}

const VOICE_SESSION_TTL = 7200;

@Injectable()
export class WerewolfVoiceService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private cloudflareCallsService: CloudflareCallsService,
		private globalEventService: GlobalEventService,
	) {}

	@bindThis
	public isEnabled(): boolean {
		return this.cloudflareCallsService.isEnabled();
	}

	@bindThis
	private async getVoiceSession(gameId: MiWerewolfGame['id']): Promise<WerewolfVoiceSession | null> {
		const key = `voicecall:werewolf:${gameId}`;
		const data = await this.redisClient.get(key);
		if (!data) return null;

		const parsed = JSON.parse(data);
		parsed.createdAt = new Date(parsed.createdAt);
		for (const state of Object.values(parsed.participants)) {
			(state as ParticipantVoiceState).connectedAt = new Date((state as ParticipantVoiceState).connectedAt);
		}
		return parsed;
	}

	@bindThis
	private async saveVoiceSession(session: WerewolfVoiceSession): Promise<void> {
		const key = `voicecall:werewolf:${session.gameId}`;
		await this.redisClient.setex(
			key,
			VOICE_SESSION_TTL,
			JSON.stringify(session),
		);
	}

	@bindThis
	private async deleteVoiceSession(gameId: MiWerewolfGame['id']): Promise<void> {
		const key = `voicecall:werewolf:${gameId}`;
		await this.redisClient.del(key);
	}

	@bindThis
	public async initializeVoiceSession(gameId: MiWerewolfGame['id']): Promise<boolean> {
		if (!this.isEnabled()) {
			return false;
		}

		const existing = await this.getVoiceSession(gameId);
		if (existing) {
			return true;
		}

		const appCreds = await this.cloudflareCallsService.getAppCredentials();
		if (!appCreds) {
			return false;
		}

		const session: WerewolfVoiceSession = {
			gameId,
			appId: appCreds.appId,
			appSecret: appCreds.appSecret,
			participants: {},
			createdAt: new Date(),
		};

		await this.saveVoiceSession(session);
		return true;
	}

	@bindThis
	public async joinVoiceSession(
		gameId: MiWerewolfGame['id'],
		userId: MiUser['id'],
	): Promise<{
		sessionId: string;
		otherSessions: Record<MiUser['id'], string>;
	} | null> {
		const session = await this.getVoiceSession(gameId);
		if (!session) {
			const initialized = await this.initializeVoiceSession(gameId);
			if (!initialized) return null;
			return await this.joinVoiceSession(gameId, userId);
		}

		if (session.participants[userId]) {
			const existingState = session.participants[userId];

			const otherSessions: Record<string, string> = {};
			for (const [uid, state] of Object.entries(session.participants)) {
				if (uid !== userId) {
					otherSessions[uid] = state.sessionId;
				}
			}

			return {
				sessionId: existingState.sessionId,
				otherSessions,
			};
		}

		const cfSession = await this.cloudflareCallsService.createSession(
			session.appId,
			session.appSecret,
		);
		if (!cfSession) {
			return null;
		}

		session.participants[userId] = {
			sessionId: cfSession.sessionId,
			trackName: `audio-${userId}`,
			connectedAt: new Date(),
		};

		await this.saveVoiceSession(session);

		const otherSessions: Record<string, string> = {};
		for (const [uid, state] of Object.entries(session.participants)) {
			if (uid !== userId) {
				otherSessions[uid] = state.sessionId;
			}
		}

		return {
			sessionId: cfSession.sessionId,
			otherSessions,
		};
	}

	@bindThis
	public async negotiateTracks(
		gameId: MiWerewolfGame['id'],
		userId: MiUser['id'],
		offer: RTCSessionDescriptionInit,
	): Promise<RTCSessionDescriptionInit | null> {
		const session = await this.getVoiceSession(gameId);
		if (!session) {
			console.error('Voice session not found:', gameId);
			return null;
		}

		const myState = session.participants[userId];
		if (!myState) {
			console.error('User not in voice session:', userId);
			return null;
		}

		const sdpLines = (offer.sdp || '').split('\r\n');
		const midLine = sdpLines.find((line: string) => line.startsWith('a=mid:'));
		const mid = midLine ? midLine.split(':')[1] : '0';

		const localTracks = [{
			location: 'local' as const,
			mid,
			trackName: myState.trackName,
		}];

		const pushResult = await this.cloudflareCallsService.addTrack(
			session.appId,
			session.appSecret,
			myState.sessionId,
			offer,
			localTracks,
		);

		if (!pushResult) {
			console.error('Failed to push local track');
			return null;
		}

		if (pushResult.hasErrors) {
			const errorTrack = pushResult.tracks?.[0];
			if (errorTrack?.errorCode === 'session_error' || errorTrack?.errorDescription?.includes('disconnected')) {
				delete session.participants[userId];
				await this.saveVoiceSession(session);
				return null;
			}
			console.error('Track push errors:', pushResult.tracks);
			return null;
		}

		if (pushResult.tracks && pushResult.tracks.length > 0) {
			const localTrackResult = pushResult.tracks[0];
			if (localTrackResult.mid === mid) {
				myState.trackId = localTrackResult.trackName;
				await this.saveVoiceSession(session);
			}
		}

		this.globalEventService.publishWerewolfGameStream(gameId, 'voiceTrackReady', {
			userId,
			sessionId: myState.sessionId,
			trackName: myState.trackName,
		});

		return pushResult.sessionDescription;
	}

	@bindThis
	public async pullRemoteTracks(
		gameId: MiWerewolfGame['id'],
		userId: MiUser['id'],
		currentOffer: RTCSessionDescriptionInit,
	): Promise<RTCSessionDescriptionInit | null> {
		const session = await this.getVoiceSession(gameId);
		if (!session) {
			console.error('Voice session not found:', gameId);
			return null;
		}

		const myState = session.participants[userId];
		if (!myState) {
			console.error('User not in voice session:', userId);
			return null;
		}

		const remoteTracks: Array<{
			location: 'remote';
			trackName: string;
			sessionId: string;
		}> = [];

		for (const [otherUserId, otherState] of Object.entries(session.participants)) {
			if (otherUserId === userId) continue;

			try {
				const sessionInfo = await this.cloudflareCallsService.getSessionInfo(
					session.appId,
					session.appSecret,
					otherState.sessionId,
				);

				if (sessionInfo && sessionInfo.tracks && sessionInfo.tracks.length > 0) {
					for (const track of sessionInfo.tracks) {
						remoteTracks.push({
							location: 'remote',
							trackName: track.trackName,
							sessionId: otherState.sessionId,
						});
					}
				} else if (sessionInfo === null) {
					console.warn('Skipping user due to session validation failure:', otherUserId);
				}
			} catch (error) {
				console.error('Failed to validate session for user:', otherUserId, error);
			}
		}

		if (remoteTracks.length === 0) {
			return currentOffer;
		}

		const pullResult = await this.cloudflareCallsService.addTrack(
			session.appId,
			session.appSecret,
			myState.sessionId,
			currentOffer,
			remoteTracks,
		);

		if (!pullResult) {
			console.error('Failed to pull remote tracks');
			return null;
		}

		if (pullResult.hasErrors) {
			console.error('Track pull errors:', pullResult.tracks);
			return null;
		}

		return pullResult.sessionDescription;
	}

	@bindThis
	public async leaveVoiceSession(
		gameId: MiWerewolfGame['id'],
		userId: MiUser['id'],
	): Promise<void> {
		const session = await this.getVoiceSession(gameId);
		if (!session) return;

		if (!session.participants[userId]) return;

		delete session.participants[userId];
		await this.saveVoiceSession(session);
	}

	@bindThis
	public async cleanupVoiceSession(gameId: MiWerewolfGame['id']): Promise<void> {
		const session = await this.getVoiceSession(gameId);
		if (!session) return;

		await this.deleteVoiceSession(gameId);
	}

	@bindThis
	public async getParticipantCount(gameId: MiWerewolfGame['id']): Promise<number> {
		const session = await this.getVoiceSession(gameId);
		if (!session) return 0;
		return Object.keys(session.participants).length;
	}
}
