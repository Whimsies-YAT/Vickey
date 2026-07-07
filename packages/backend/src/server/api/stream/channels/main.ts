/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { isInstanceMuted, isUserFromMutedInstance } from '@/misc/is-instance-muted.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { VoiceCallService } from '@/core/VoiceCallService.js';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class MainChannel extends Channel {
	public readonly chName = 'main';
	public static shouldShare = true;
	public static requireCredential = true as const;
	public static kind = 'read:account';

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private noteEntityService: NoteEntityService,
		private voiceCallService: VoiceCallService,
	) {
		super(request);
	}

	private activeCallId: string | null = null;

	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (!this.user) return false;

		const currentCall = await this.voiceCallService.getCurrentCall(this.user!.id);
		if (currentCall) {
			this.activeCallId = currentCall.callId;

			if (currentCall.recipientId === this.user!.id && currentCall.status === 'ringing') {
				this.send('voiceCall', {
					type: 'incoming',
					callId: currentCall.callId,
					from: currentCall.callerId,
					mode: currentCall.mode,
					currentMode: currentCall.currentMode,
				});
			} else if (currentCall.status === 'connecting' || currentCall.status === 'connected') {
				const peerId = currentCall.callerId === this.user!.id ? currentCall.recipientId : currentCall.callerId;
				const isIncoming = currentCall.recipientId === this.user!.id;

				this.send('voiceCall', {
					type: 'restored',
					callId: currentCall.callId,
					peerId,
					isIncoming,
					state: currentCall.status,
					mode: currentCall.mode,
					currentMode: currentCall.currentMode,
				});
			}
		}

		// Subscribe main stream channel
		this.subscriber.on(`mainStream:${this.user.id}`, async data => {
			switch (data.type) {
				case 'notification': {
					// Ignore notifications from instances the user has muted
					if (isUserFromMutedInstance(data.body, new Set<string>(this.userProfile?.mutedInstances ?? []))) return;
					if (data.body.userId && this.userIdsWhoMeMuting.has(data.body.userId)) return;

					if (data.body.note && data.body.note.isHidden) {
						const note = await this.noteEntityService.pack(data.body.note.id, this.user, {
							detail: true,
						});
						data.body.note = note;
					}
					break;
				}
				case 'mention': {
					if (isInstanceMuted(data.body, new Set<string>(this.userProfile?.mutedInstances ?? []))) return;
					if (!this.isNoteVisibleForMe(data.body)) return;
					if (this.isNoteMutedOrBlocked(data.body)) return;
					if (data.body.isHidden) {
						const note = await this.noteEntityService.pack(data.body.id, this.user, {
							detail: true,
						});
						data.body = note;
					}
					break;
				}
				case 'voiceCall': {
					// Voice call events are always sent
					break;
				}
			}

			this.send(data.type, data.body);
		});

		return true;
	}

	@bindThis
	public dispose() {
		// End any active voice call when the WebSocket connection is closed
		if (this.activeCallId) {
			this.voiceCallService.endCall(this.activeCallId, this.user!.id);
		}
	}

	@bindThis
	public async onMessage(type: string, body: any) {
		switch (type) {
			case 'voiceCall:initiate':
				await this.handleVoiceCallInitiate(body);
				break;
			case 'voiceCall:answer':
				await this.handleVoiceCallAnswer(body);
				break;
			case 'voiceCall:reject':
				await this.handleVoiceCallReject(body);
				break;
			case 'voiceCall:end':
				await this.handleVoiceCallEnd(body);
				break;
			case 'voiceCall:pushTracks':
				await this.handleVoiceCallPushTracks(body);
				break;
			case 'voiceCall:tracksReady':
				await this.handleVoiceCallTracksReady(body);
				break;
			case 'voiceCall:pullTracks':
				await this.handleVoiceCallPullTracks(body);
				break;
			case 'voiceCall:answerPull':
				await this.handleVoiceCallAnswerPull(body);
				break;
			case 'voiceCall:signal':
				await this.handleVoiceCallSignal(body);
				break;
			case 'voiceCall:switchToSfu':
				await this.handleVoiceCallSwitchToSfu(body);
				break;
		}
	}

	@bindThis
	private async handleVoiceCallInitiate(body: { recipientId: string; mode?: 'auto' | 'p2p' | 'sfu' }) {
		const result = await this.voiceCallService.initiateCall(
			this.user!.id,
			body.recipientId,
			body.mode || 'auto',
		);

		if (result) {
			this.activeCallId = result.callId;
			this.send('voiceCall', {
				type: 'initiated',
				callId: result.callId,
				iceServers: result.iceServers.map(server => ({
					urls: server.urls,
					username: server.username,
					credential: server.credential,
				})),
				sessionId: result.sessionId,
				mode: result.mode,
				currentMode: result.currentMode,
			});
		} else {
			this.send('voiceCall', {
				type: 'error',
				message: 'Failed to initiate call',
			});
		}
	}

	@bindThis
	private async handleVoiceCallAnswer(body: { callId: string }) {
		const result = await this.voiceCallService.answerCall(body.callId, this.user!.id);

		if (result) {
			this.activeCallId = body.callId;
			this.send('voiceCall', {
				type: 'ready',
				callId: body.callId,
				iceServers: result.iceServers.map(server => ({
					urls: server.urls,
					username: server.username,
					credential: server.credential,
				})),
				sessionId: result.sessionId,
				mode: result.mode,
				currentMode: result.currentMode,
			});
		}
	}

	@bindThis
	private async handleVoiceCallReject(body: { callId: string }) {
		await this.voiceCallService.rejectCall(body.callId, this.user!.id);
		this.activeCallId = null;
	}

	@bindThis
	private async handleVoiceCallEnd(body: { callId: string }) {
		await this.voiceCallService.endCall(body.callId, this.user!.id);
		this.activeCallId = null;
	}

	@bindThis
	private async handleVoiceCallPushTracks(body: { callId: string; offer: any; tracks: Array<{ mid: string; trackName: string }> }) {
		if (!body?.offer || typeof body.offer !== 'object' || !body.offer.type || !body.offer.sdp) {
			this.send('voiceCall', {
				type: 'error',
				callId: body?.callId,
				message: 'Invalid offer format',
			});
			return;
		}

		if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
			this.send('voiceCall', {
				type: 'error',
				callId: body.callId,
				message: 'Invalid tracks array',
			});
			return;
		}

		const result = await this.voiceCallService.pushTracks(
			body.callId,
			this.user!.id,
			body.offer,
			body.tracks,
		);

		if (result?.answer?.type && result?.answer?.sdp) {
			this.send('voiceCall', {
				type: 'tracksAnswered',
				callId: body.callId,
				answer: {
					type: result.answer.type,
					sdp: result.answer.sdp,
				},
			});
		} else {
			this.send('voiceCall', {
				type: 'error',
				callId: body.callId,
				message: 'Failed to push tracks',
			});
		}
	}

	@bindThis
	private async handleVoiceCallTracksReady(body: { callId: string }) {
		await this.voiceCallService.markTracksReady(body.callId, this.user!.id);
	}

	@bindThis
	private async handleVoiceCallPullTracks(body: { callId: string; offer: any }) {
		if (!body?.offer || typeof body.offer !== 'object' || !body.offer.type || !body.offer.sdp) {
			this.send('voiceCall', {
				type: 'error',
				callId: body?.callId,
				message: 'Invalid offer format',
			});
			return;
		}

		const result = await this.voiceCallService.pullTracks(
			body.callId,
			this.user!.id,
			body.offer,
		);

		if (result?.answer?.type && result?.answer?.sdp) {
			this.send('voiceCall', {
				type: 'pullAnswered',
				callId: body.callId,
				answer: {
					type: result.answer.type,
					sdp: result.answer.sdp,
				},
			});
		} else {
			this.send('voiceCall', {
				type: 'error',
				callId: body.callId,
				message: 'Failed to pull tracks',
			});
		}
	}

	@bindThis
	private async handleVoiceCallAnswerPull(body: { callId: string; answer: any }) {
		const success = await this.voiceCallService.answerPull(
			body.callId,
			this.user!.id,
			body.answer,
		);

		if (success) {
			this.send('voiceCall', {
				type: 'pullCompleted',
				callId: body.callId,
			});
		}
	}

	@bindThis
	private async handleVoiceCallSignal(body: { callId: string; signalType: 'iceCandidate' | 'offer' | 'answer'; signalData: any }) {
		await this.voiceCallService.relaySignaling(
			body.callId,
			this.user!.id,
			body.signalType,
			body.signalData,
		);
	}

	@bindThis
	private async handleVoiceCallSwitchToSfu(body: { callId: string }) {
		const result = await this.voiceCallService.switchToSfu(body.callId, this.user!.id);

		if (result) {
			this.send('voiceCall', {
				type: 'switchedToSfu',
				callId: body.callId,
				sessionId: result.sessionId,
			});
		} else {
			this.send('voiceCall', {
				type: 'error',
				callId: body.callId,
				message: 'Failed to switch to SFU',
			});
		}
	}
}
