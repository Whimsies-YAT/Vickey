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
	const pendingSignals = ref<Array<{ signalType: string; signalData: any }>>([]);
	const connectionState = ref<RTCPeerConnectionState>('new');
	const callDuration = ref(0);
	let callDurationInterval: number | null = null;
	let isInitializingPeerConnection = false;
	let connectionTimeoutId: number | null = null;

	async function initPeerConnection(iceServers: RTCIceServer[]) {
		console.log('Initializing peer connection with ICE servers:', iceServers);
		isInitializingPeerConnection = true;

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
			console.log('Received remote track:', event.streams[0]);
			console.log('Track details:', {
				kind: event.track.kind,
				enabled: event.track.enabled,
				muted: event.track.muted,
				readyState: event.track.readyState,
			});
			remoteStream.value = event.streams[0];

			const audioTracks = event.streams[0].getAudioTracks();
			console.log('Audio tracks:', audioTracks.length, audioTracks.map(t => ({
				id: t.id,
				enabled: t.enabled,
				muted: t.muted,
				readyState: t.readyState,
			})));
		};

		peerConnection.value.onconnectionstatechange = () => {
			if (peerConnection.value) {
				connectionState.value = peerConnection.value.connectionState;
				console.log('Connection state changed:', connectionState.value);

				if (connectionState.value === 'disconnected' || connectionState.value === 'failed' || connectionState.value === 'closed') {
					console.log('Connection lost, cleaning up...');
					cleanup();
				}
			}
		};

		peerConnection.value.oniceconnectionstatechange = () => {
			if (peerConnection.value) {
				console.log('ICE connection state:', peerConnection.value.iceConnectionState);

				if (peerConnection.value.iceConnectionState === 'disconnected' ||
					peerConnection.value.iceConnectionState === 'failed' ||
					peerConnection.value.iceConnectionState === 'closed') {
					console.log('ICE connection lost, cleaning up...');
					cleanup();
				}
			}
		};

		if (localStream.value) {
			console.log('Adding local stream tracks to peer connection');
			localStream.value.getTracks().forEach(track => {
				console.log('Adding track:', track.kind, track.id);
				peerConnection.value!.addTrack(track, localStream.value!);
			});
		}

		isInitializingPeerConnection = false;
		console.log('Peer connection initialized, processing', pendingSignals.value.length, 'pending signals');

		while (pendingSignals.value.length > 0) {
			const signal = pendingSignals.value.shift();
			if (signal) {
				console.log('Processing queued signal:', signal.signalType);
				await processSignal(signal.signalType, signal.signalData);
			}
		}
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
			clearInterval(callDurationInterval);
			callDurationInterval = null;
			callDuration.value = 0;
		}
	}

	function clearConnectionTimeout() {
		if (connectionTimeoutId !== null) {
			clearTimeout(connectionTimeoutId);
			connectionTimeoutId = null;
		}
	}

	function startConnectionTimeout() {
		clearConnectionTimeout();
		connectionTimeoutId = window.setTimeout(() => {
			console.log('Connection timeout, cleaning up...');
			cleanup();
		}, 30000);
	}

	function cleanup() {
		console.log('Cleaning up voice call...');

		if (peerConnection.value) {
			peerConnection.value.close();
			peerConnection.value = null;
		}

		if (localStream.value) {
			localStream.value.getTracks().forEach(track => track.stop());
			localStream.value = null;
		}

		stopCallDurationTimer();
		clearConnectionTimeout();
		remoteStream.value = null;
		currentCall.value = null;
		pendingSignals.value = [];
		connectionState.value = 'new';
	}

	async function processSignal(signalType: string, signalData: any) {
		if (!peerConnection.value || !currentCall.value) {
			return;
		}

		if (signalType === 'offer') {
			await peerConnection.value.setRemoteDescription(signalData);

			const answer = await peerConnection.value.createAnswer();
			await peerConnection.value.setLocalDescription(answer);

			mainChannel.send('voiceCall:signal', {
				callId: currentCall.value.callId,
				signalType: 'answer',
				signalData: peerConnection.value.localDescription,
			});

			currentCall.value.state = 'connected';
			startCallDurationTimer();
		} else if (signalType === 'answer') {
			await peerConnection.value.setRemoteDescription(signalData);
			if (currentCall.value) {
				currentCall.value.state = 'connected';
				startCallDurationTimer();
			}
		} else if (signalType === 'iceCandidate') {
			if (signalData && signalData.candidate) {
				await peerConnection.value.addIceCandidate(
					new RTCIceCandidate({
						candidate: signalData.candidate,
						sdpMLineIndex: signalData.sdpMLineIndex,
						sdpMid: signalData.sdpMid,
					}),
				);
			}
		}
	}

	mainChannel.on('voiceCall', async (data) => {
		switch (data.type) {
			case 'incoming': {
				currentCall.value = {
					callId: data.callId,
					peerId: data.from,
					state: 'ringing',
					isIncoming: true,
				};
				break;
			}

			case 'initiated': {
				if (currentCall.value) {
					currentCall.value.callId = data.callId;
					await initPeerConnection(data.iceServers);

					const offer = await peerConnection.value!.createOffer();
					await peerConnection.value!.setLocalDescription(offer);

					mainChannel.send('voiceCall:signal', {
						callId: currentCall.value.callId,
						signalType: 'offer',
						signalData: peerConnection.value!.localDescription,
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
				if (currentCall.value && data.callId === currentCall.value.callId) {
					await initPeerConnection(data.iceServers);
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
				if (!currentCall.value || data.callId !== currentCall.value.callId) {
					return;
				}

				if (!peerConnection.value || isInitializingPeerConnection) {
					console.log('Queueing signal until PeerConnection is initialized:', data.signalType);
					pendingSignals.value.push({
						signalType: data.signalType,
						signalData: data.signalData,
					});
					return;
				}

				console.log('Processing signal immediately:', data.signalType);
				await processSignal(data.signalType, data.signalData);
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
