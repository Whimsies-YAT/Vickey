/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { isInstanceMuted, isUserFromMutedInstance } from '@/misc/is-instance-muted.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { VoiceCallService } from '@/core/VoiceCallService.js';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class MainChannel extends Channel {
	public readonly chName = 'main';
	public static shouldShare = true;
	public static requireCredential = true as const;
	public static kind = 'read:account';

	constructor(
		private noteEntityService: NoteEntityService,
		private voiceCallService: VoiceCallService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
	}

	private activeCallId: string | null = null;

	@bindThis
	public async init(params: JsonObject) {
		// Subscribe main stream channel
		this.subscriber.on(`mainStream:${this.user!.id}`, async data => {
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

					if (this.userIdsWhoMeMuting.has(data.body.userId)) return;
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
			case 'voiceCall:pullTracks':
				await this.handleVoiceCallPullTracks(body);
				break;
			case 'voiceCall:answerPull':
				await this.handleVoiceCallAnswerPull(body);
				break;
			case 'voiceCall:signal':
				await this.handleVoiceCallSignal(body);
				break;
		}
	}

	@bindThis
	private async handleVoiceCallInitiate(body: { recipientId: string }) {
		const result = await this.voiceCallService.initiateCall(
			this.user!.id,
			body.recipientId,
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
				sessionId: result.callerSessionId,
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
				sessionId: result.recipientSessionId,
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
		const result = await this.voiceCallService.pushTracks(
			body.callId,
			this.user!.id,
			body.offer,
			body.tracks,
		);

		if (result) {
			this.send('voiceCall', {
				type: 'tracksAnswered',
				callId: body.callId,
				answer: {
					type: result.answer.type,
					sdp: result.answer.sdp,
				},
				requiresPull: result.requiresPull,
			});
		}
	}

	@bindThis
	private async handleVoiceCallPullTracks(body: { callId: string }) {
		const result = await this.voiceCallService.pullTracks(
			body.callId,
			this.user!.id,
		);

		if (result) {
			this.send('voiceCall', {
				type: 'pullOffer',
				callId: body.callId,
				offer: {
					type: result.offer.type,
					sdp: result.offer.sdp,
				},
				tracks: result.tracks,
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
	private async handleVoiceCallSignal(body: { callId: string; signalType: 'iceCandidate'; signalData: any }) {
		await this.voiceCallService.relaySignaling(
			body.callId,
			this.user!.id,
			body.signalType,
			body.signalData,
		);
	}
}

@Injectable()
export class MainChannelService implements MiChannelService<true> {
	public readonly shouldShare = MainChannel.shouldShare;
	public readonly requireCredential = MainChannel.requireCredential;
	public readonly kind = MainChannel.kind;

	constructor(
		private noteEntityService: NoteEntityService,
		private voiceCallService: VoiceCallService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): MainChannel {
		return new MainChannel(
			this.noteEntityService,
			this.voiceCallService,
			id,
			connection,
		);
	}
}
