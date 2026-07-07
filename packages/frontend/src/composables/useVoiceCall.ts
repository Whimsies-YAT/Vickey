/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, shallowRef } from 'vue';
import { useStream } from '@/stream.js';
import { AudioProcessor } from './audio-processor';

export type VoiceCallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';
export type VoiceCallMode = 'auto' | 'p2p' | 'sfu';

export interface VoiceCall {
	callId: string;
	peerId: string;
	state: VoiceCallState;
	isIncoming: boolean;
	mode: VoiceCallMode;
	currentMode: 'p2p' | 'sfu';
}

type VoiceCallEvent = {
	type?: string;
	callId?: string;
	from?: string;
	peerId?: string;
	state?: VoiceCallState;
	isIncoming?: boolean;
	mode?: VoiceCallMode;
	currentMode?: 'p2p' | 'sfu';
	iceServers?: RTCIceServer[];
	sessionId?: string;
	answer?: RTCSessionDescriptionInit;
	signalType?: string;
	signalData?: RTCSessionDescriptionInit | RTCIceCandidateInit;
	message?: string;
};

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
	const localMuted = ref(false);
	const remoteVolume = ref(1.0);
	let audioProcessor: AudioProcessor | null = null;
	let rawMicStream: MediaStream | null = null;

	let pendingTracksReady = false;

	async function initPeerConnection(iceServers: RTCIceServer[]) {
		pendingTracksReady = false;

		peerConnection.value = new RTCPeerConnection({
			iceServers,
			iceTransportPolicy: 'all',
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
		});

		peerConnection.value.onicecandidate = (event) => {
			if (event.candidate && currentCall.value) {
				if (currentCall.value.currentMode === 'p2p') {
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
			}
		};

		peerConnection.value.ontrack = (event) => {
			remoteStream.value = event.streams[0] ?? new MediaStream([event.track]);
		};

		peerConnection.value.onconnectionstatechange = () => {
			if (peerConnection.value) {
				connectionState.value = peerConnection.value.connectionState;

				if (connectionState.value === 'connected') {
					if (currentCall.value) {
						// In SFU mode, only mark as connected after pull is done
						if (currentCall.value.currentMode === 'p2p') {
							currentCall.value.state = 'connected';
							startCallDurationTimer();
						}
					}

					// Send tracksReady if we've been waiting for connection
					if (pendingTracksReady && currentCall.value) {
						pendingTracksReady = false;
						mainChannel.send('voiceCall:tracksReady', {
							callId: currentCall.value.callId,
						});
					}
				}

				if (connectionState.value === 'failed' || connectionState.value === 'closed') {
					cleanup();
				}
			}
		};

		peerConnection.value.oniceconnectionstatechange = () => {
			if (peerConnection.value) {
				const iceState = peerConnection.value.iceConnectionState;

				if (iceState === 'failed' || iceState === 'closed') {
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

	async function pullRemoteTracks() {
		if (!peerConnection.value || !currentCall.value) return;

		peerConnection.value.addTransceiver('audio', { direction: 'recvonly' });

		const offer = await peerConnection.value.createOffer();
		await peerConnection.value.setLocalDescription(offer);

		mainChannel.send('voiceCall:pullTracks', {
			callId: currentCall.value.callId,
			offer: {
				type: offer.type,
				sdp: offer.sdp,
			},
		});
	}

	async function call(recipientId: string, mode: VoiceCallMode = 'auto') {
		if (currentCall.value) {
			throw new Error('Already in a call');
		}

		try {
			rawMicStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			});

			audioProcessor = new AudioProcessor();
			localStream.value = await audioProcessor.initialize(rawMicStream);

			mainChannel.send('voiceCall:initiate', {
				recipientId,
				mode,
			});

			currentCall.value = {
				callId: '',
				peerId: recipientId,
				state: 'calling',
				isIncoming: false,
				mode,
				currentMode: 'p2p',
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
			rawMicStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			});

			audioProcessor = new AudioProcessor();
			localStream.value = await audioProcessor.initialize(rawMicStream);

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

	function toggleLocalMute() {
		if (!localStream.value) return;

		const audioTracks = localStream.value.getAudioTracks();
		audioTracks.forEach(track => {
			track.enabled = !track.enabled;
		});
		localMuted.value = !localMuted.value;
	}

	function setRemoteVolume(volume: number) {
		remoteVolume.value = Math.max(0, Math.min(1, volume));
	}

	function cleanup() {
		if (peerConnection.value) {
			peerConnection.value.close();
			peerConnection.value = null;
		}

		if (audioProcessor) {
			audioProcessor.cleanup();
			audioProcessor = null;
		}

		if (localStream.value) {
			localStream.value.getTracks().forEach(track => track.stop());
			localStream.value = null;
		}

		if (rawMicStream) {
			rawMicStream.getTracks().forEach(track => track.stop());
			rawMicStream = null;
		}

		stopCallDurationTimer();
		pendingTracksReady = false;
		remoteStream.value = null;
		currentCall.value = null;
		connectionState.value = 'new';
		localMuted.value = false;
		remoteVolume.value = 1.0;
	}

	mainChannel.on('voiceCall', async (data: VoiceCallEvent) => {
		switch (data.type) {
			case 'incoming': {
				if (!data.callId || !data.from || !data.mode) return;
				currentCall.value = {
					callId: data.callId,
					peerId: data.from,
					state: 'ringing',
					isIncoming: true,
					mode: data.mode,
					currentMode: data.currentMode ?? 'p2p',
				};
				break;
			}

			case 'restored': {
				if (!data.callId || !data.peerId) return;
				currentCall.value = {
					callId: data.callId,
					peerId: data.peerId,
					state: data.state || 'ringing',
					isIncoming: data.isIncoming || false,
					mode: data.mode || 'auto',
					currentMode: data.currentMode || 'p2p',
				};
				break;
			}

			case 'initiated': {
				if (!currentCall.value || !data.callId || !data.mode || !data.currentMode) return;
				currentCall.value.callId = data.callId;
				currentCall.value.mode = data.mode;
				currentCall.value.currentMode = data.currentMode;

				if (data.currentMode === 'sfu') {
					if (!data.sessionId) return;
					await initPeerConnection([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
					await pushLocalTracks();
				} else {
					await initPeerConnection(data.iceServers || []);
					const offer = await peerConnection.value!.createOffer();
					await peerConnection.value!.setLocalDescription(offer);
					mainChannel.send('voiceCall:signal', {
						callId: currentCall.value.callId,
						signalType: 'offer',
						signalData: { type: offer.type, sdp: offer.sdp },
					});
				}
				break;
			}

			case 'answered': {
				if (currentCall.value && data.callId === currentCall.value.callId) {
					currentCall.value.state = 'connecting';
				}
				break;
			}

			case 'ready': {
				if (!currentCall.value || !data.callId || !data.mode || !data.currentMode) return;
				if (data.callId === currentCall.value.callId) {
					currentCall.value.mode = data.mode;
					currentCall.value.currentMode = data.currentMode;

					if (data.currentMode === 'sfu') {
						if (!data.sessionId) return;
						await initPeerConnection([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
						await pushLocalTracks();
					} else {
						await initPeerConnection(data.iceServers || []);
					}
				}
				break;
			}

			case 'tracksAnswered': {
				if (!currentCall.value || !peerConnection.value || !data.answer) return;
				if (data.callId !== currentCall.value.callId) return;

				await peerConnection.value.setRemoteDescription(data.answer);

				if (peerConnection.value.connectionState === 'connected') {
					mainChannel.send('voiceCall:tracksReady', {
						callId: currentCall.value.callId,
					});
				} else {
					pendingTracksReady = true;
				}
				break;
			}

			case 'readyToPull': {
				if (!currentCall.value) return;
				if (data.callId !== currentCall.value.callId) return;

				await pullRemoteTracks();
				break;
			}

			case 'pullAnswered': {
				if (!currentCall.value || !peerConnection.value || !data.answer) return;
				if (data.callId !== currentCall.value.callId) return;

				await peerConnection.value.setRemoteDescription(data.answer);

				if (currentCall.value.state !== 'connected') {
					currentCall.value.state = 'connected';
					startCallDurationTimer();
				}
				break;
			}

			case 'pullCompleted': {
				if (!currentCall.value) return;
				if (data.callId !== currentCall.value.callId) return;

				if (currentCall.value.state !== 'connected') {
					currentCall.value.state = 'connected';
					startCallDurationTimer();
				}
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
					const signalData = data.signalData as RTCIceCandidateInit | undefined;
					if (signalData?.candidate) {
						await peerConnection.value.addIceCandidate(
							new RTCIceCandidate({
								candidate: signalData.candidate,
								sdpMLineIndex: signalData.sdpMLineIndex,
								sdpMid: signalData.sdpMid,
							}),
						);
					}
				} else if (data.signalType === 'offer') {
					await peerConnection.value.setRemoteDescription(new RTCSessionDescription(data.signalData as RTCSessionDescriptionInit));
					const answer = await peerConnection.value.createAnswer();
					await peerConnection.value.setLocalDescription(answer);
					mainChannel.send('voiceCall:signal', {
						callId: currentCall.value.callId,
						signalType: 'answer',
						signalData: { type: answer.type, sdp: answer.sdp },
					});
					currentCall.value.state = 'connected';
					startCallDurationTimer();
				} else if (data.signalType === 'answer') {
					await peerConnection.value.setRemoteDescription(new RTCSessionDescription(data.signalData as RTCSessionDescriptionInit));
					currentCall.value.state = 'connected';
					startCallDurationTimer();
				}
				break;
			}

			case 'switchToSfu': {
				if (!currentCall.value || !data.callId) return;
				if (data.callId !== currentCall.value.callId) return;
				currentCall.value.currentMode = 'sfu';
				if (peerConnection.value) {
					peerConnection.value.close();
					peerConnection.value = null;
				}
				break;
			}

			case 'switchedToSfu': {
				if (!currentCall.value || !data.callId || !data.sessionId) return;
				if (data.callId !== currentCall.value.callId) return;
				await initPeerConnection([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
				await pushLocalTracks();
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
		localMuted,
		remoteVolume,
		call,
		answer,
		reject,
		end,
		toggleLocalMute,
		setRemoteVolume,
	};
}
