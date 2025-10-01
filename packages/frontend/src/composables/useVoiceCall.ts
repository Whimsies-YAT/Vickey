/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, shallowRef } from 'vue';
import { useStream } from '@/stream.js';

export type VoiceCallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

export interface VoiceCall {
	callId: string;
	peerId: string;
	state: VoiceCallState;
	isIncoming: boolean;
}

export function useVoiceCall() {
	const stream = useStream();
	const mainChannel = stream.useChannel('main');

	const currentCall = ref<VoiceCall | null>(null);
	const peerConnection = shallowRef<RTCPeerConnection | null>(null);
	const localStream = shallowRef<MediaStream | null>(null);
	const remoteStream = shallowRef<MediaStream | null>(null);
	const connectionState = ref<RTCPeerConnectionState>('new');
	const callDuration = ref(0);
	let callDurationInterval: number | null = null;
	let sessionId: string | null = null;

	async function initPeerConnection(iceServers: RTCIceServer[], sessionIdFromServer: string) {
		sessionId = sessionIdFromServer;

		peerConnection.value = new RTCPeerConnection({
			iceServers,
		});

		peerConnection.value.onicecandidate = (event) => {
			if (event.candidate && currentCall.value) {
				mainChannel.send('voiceCall:signal', {
					callId: currentCall.value.callId,
					signalType: 'iceCandidate',
					signalData: {
						candidate: event.candidate.candidate,
						sdpMLineIndex: event.candidate.sdpMLineIndex,
						sdpMid: event.candidate.sdpMid,
					},
				});
			}
		};

		peerConnection.value.ontrack = (event) => {
			const stream = event.streams[0];
			remoteStream.value = stream;
		};

		peerConnection.value.onconnectionstatechange = () => {
			if (peerConnection.value) {
				connectionState.value = peerConnection.value.connectionState;

				if (connectionState.value === 'disconnected' || connectionState.value === 'failed' || connectionState.value === 'closed') {
					cleanup();
				}
			}
		};

		peerConnection.value.oniceconnectionstatechange = () => {
			if (peerConnection.value) {
				const iceState = peerConnection.value.iceConnectionState;

				if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
					cleanup();
				}
			}
		};

		if (localStream.value) {
			localStream.value.getTracks().forEach(track => {
				peerConnection.value!.addTrack(track, localStream.value!);
			});
		}
	}

	async function pushLocalTracks() {
		if (!peerConnection.value || !currentCall.value) return;

		const offer = await peerConnection.value.createOffer();
		await peerConnection.value.setLocalDescription(offer);

		const transceivers = peerConnection.value.getTransceivers();
		const tracks = transceivers
			.filter(t => t.sender.track)
			.map(t => ({
				mid: t.mid!,
				trackName: t.sender.track!.kind,
			}));

		mainChannel.send('voiceCall:pushTracks', {
			callId: currentCall.value.callId,
			offer: {
				type: offer.type,
				sdp: offer.sdp,
			},
			tracks,
		});
	}

	async function call(recipientId: string) {
		try {
			localStream.value = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});

			mainChannel.send('voiceCall:initiate', {
				recipientId,
			});

			currentCall.value = {
				callId: '',
				peerId: recipientId,
				state: 'calling',
				isIncoming: false,
			};
		} catch (error) {
			console.error('Failed to initiate call:', error);
			cleanup();
			throw error;
		}
	}

	async function answer() {
		if (!currentCall.value || !currentCall.value.isIncoming) {
			return;
		}

		try {
			localStream.value = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});

			currentCall.value.state = 'connecting';

			mainChannel.send('voiceCall:answer', {
				callId: currentCall.value.callId,
			});
		} catch (error) {
			console.error('Failed to answer call:', error);
			cleanup();
			throw error;
		}
	}

	function reject() {
		if (!currentCall.value || !currentCall.value.isIncoming) {
			return;
		}

		mainChannel.send('voiceCall:reject', {
			callId: currentCall.value.callId,
		});

		cleanup();
	}

	function end() {
		if (!currentCall.value) {
			return;
		}

		mainChannel.send('voiceCall:end', {
			callId: currentCall.value.callId,
		});

		cleanup();
	}

	function startCallDurationTimer() {
		if (callDurationInterval !== null) return;

		callDuration.value = 0;
		callDurationInterval = window.setInterval(() => {
			callDuration.value++;
		}, 1000);
	}

	function stopCallDurationTimer() {
		if (callDurationInterval !== null) {
			window.clearInterval(callDurationInterval);
			callDurationInterval = null;
			callDuration.value = 0;
		}
	}

	function cleanup() {
		if (peerConnection.value) {
			peerConnection.value.close();
			peerConnection.value = null;
		}

		if (localStream.value) {
			localStream.value.getTracks().forEach(track => track.stop());
			localStream.value = null;
		}

		stopCallDurationTimer();
		remoteStream.value = null;
		currentCall.value = null;
		connectionState.value = 'new';
		sessionId = null;
	}

	mainChannel.on('voiceCall', async (data) => {
		switch (data.type) {
			case 'incoming': {
				if (!data.callId || !data.from) return;
				currentCall.value = {
					callId: data.callId,
					peerId: data.from,
					state: 'ringing',
					isIncoming: true,
				};
				break;
			}

			case 'initiated': {
				if (!currentCall.value || !data.callId || !data.iceServers || !data.sessionId) return;
				currentCall.value.callId = data.callId;
				await initPeerConnection(data.iceServers, data.sessionId);
				await pushLocalTracks();
				break;
			}

			case 'answered': {
				if (currentCall.value && data.callId === currentCall.value.callId) {
					currentCall.value.state = 'connecting';
				}
				break;
			}

			case 'ready': {
				if (!currentCall.value || !data.callId || !data.iceServers || !data.sessionId) return;
				if (data.callId === currentCall.value.callId) {
					await initPeerConnection(data.iceServers, data.sessionId);
					await pushLocalTracks();
				}
				break;
			}

			case 'tracksAnswered': {
				if (!currentCall.value || !peerConnection.value || !data.answer) return;
				if (data.callId !== currentCall.value.callId) return;

				await peerConnection.value.setRemoteDescription(data.answer);

				if (data.requiresPull) {
					mainChannel.send('voiceCall:pullTracks', {
						callId: currentCall.value.callId,
					});
				}
				break;
			}

			case 'pullOffer': {
				if (!currentCall.value || !peerConnection.value || !data.offer) return;
				if (data.callId !== currentCall.value.callId) return;

				await peerConnection.value.setRemoteDescription(data.offer);

				const answer = await peerConnection.value.createAnswer();
				await peerConnection.value.setLocalDescription(answer);

				mainChannel.send('voiceCall:answerPull', {
					callId: currentCall.value.callId,
					answer: {
						type: answer.type,
						sdp: answer.sdp,
					},
				});
				break;
			}

			case 'pullCompleted': {
				if (!currentCall.value) return;
				if (data.callId !== currentCall.value.callId) return;

				currentCall.value.state = 'connected';
				startCallDurationTimer();
				break;
			}

			case 'rejected': {
				if (currentCall.value && data.callId === currentCall.value.callId) {
					cleanup();
				}
				break;
			}

			case 'ended': {
				if (currentCall.value && data.callId === currentCall.value.callId) {
					cleanup();
				}
				break;
			}

			case 'signal': {
				if (!currentCall.value || !data.callId || !data.signalType) return;
				if (data.callId !== currentCall.value.callId) return;
				if (!peerConnection.value) return;

				if (data.signalType === 'iceCandidate') {
					if (data.signalData && data.signalData.candidate) {
						await peerConnection.value.addIceCandidate(
							new RTCIceCandidate({
								candidate: data.signalData.candidate,
								sdpMLineIndex: data.signalData.sdpMLineIndex,
								sdpMid: data.signalData.sdpMid,
							}),
						);
					}
				}
				break;
			}

			case 'error': {
				console.error('Voice call error:', data.message);
				cleanup();
				break;
			}
		}
	});

	return {
		currentCall,
		localStream,
		remoteStream,
		connectionState,
		callDuration,
		call,
		answer,
		reject,
		end,
	};
}
