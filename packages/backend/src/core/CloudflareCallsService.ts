/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta } from '@/models/Meta.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type { RTCIceServer, RTCSessionDescriptionInit } from '@/core/webrtc-types.js';

/**
 * Cloudflare Calls (Realtime SFU) service
 * @see https://developers.cloudflare.com/realtime/sfu/
 */
@Injectable()
export class CloudflareCallsService {
	// Cloudflare's free STUN server
	// @see https://developers.cloudflare.com/realtime/sfu/https-api/
	public static readonly STUN_SERVER = 'stun:stun.cloudflare.com:3478';

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private httpRequestService: HttpRequestService,
	) {}

	@bindThis
	public isEnabled(): boolean {
		if (!this.meta.enableCloudflareSfu) return false;

		const hasAppCredentials = this.meta.cloudflareSfuAppId != null && this.meta.cloudflareSfuAppSecret != null;

		const hasAccountCredentials = this.meta.cloudflareAccountId != null && this.meta.cloudflareApiToken != null;

		return hasAppCredentials || hasAccountCredentials;
	}

	@bindThis
	private hasAppCredentials(): boolean {
		return this.meta.cloudflareSfuAppId != null && this.meta.cloudflareSfuAppSecret != null;
	}

	@bindThis
	private hasAccountCredentials(): boolean {
		return this.meta.cloudflareAccountId != null && this.meta.cloudflareApiToken != null;
	}

	@bindThis
	private getBaseUrl(appId: string): string {
		return `https://rtc.live.cloudflare.com/v1/apps/${appId}`;
	}

	@bindThis
	private getAuthHeaders(): Record<string, string> {
		if (!this.meta.cloudflareApiToken) {
			throw new Error('Cloudflare API token is not configured');
		}

		return {
			'Authorization': `Bearer ${this.meta.cloudflareApiToken}`,
			'Content-Type': 'application/json',
		};
	}

	/**
	 * Create a new Cloudflare Calls app
	 * @see https://developers.cloudflare.com/api/resources/calls/subresources/sfu/methods/create/
	 */
	@bindThis
	public async createApp(name: string): Promise<{ appId: string; appSecret: string } | null> {
		if (!this.isEnabled() || !this.meta.cloudflareAccountId) {
			return null;
		}

		try {
			const url = `https://api.cloudflare.com/client/v4/accounts/${this.meta.cloudflareAccountId}/calls/apps`;

			const response = await this.httpRequestService.send(url, {
				method: 'POST',
				headers: this.getAuthHeaders(),
				body: JSON.stringify({ name }),
				timeout: 30000,
			});

			const data = await response.json() as any;

			if (!data.success || !data.result) {
				throw new Error(`Failed to create Cloudflare Calls app: ${JSON.stringify(data.errors)}`);
			}

			return {
				appId: data.result.uid,
				appSecret: data.result.secret,
			};
		} catch (error) {
			console.error('Failed to create Cloudflare Calls app:', error);
			return null;
		}
	}

	/**
	 * Get App credentials (App ID + Secret)
	 * Mode 1: Use configured App ID + Secret if available
	 * Mode 2: Fallback to creating temporary app with Account ID + API Token
	 */
	@bindThis
	public async getAppCredentials(): Promise<{ appId: string; appSecret: string } | null> {
		if (this.hasAppCredentials()) {
			return {
				appId: this.meta.cloudflareSfuAppId!,
				appSecret: this.meta.cloudflareSfuAppSecret!,
			};
		}

		if (this.hasAccountCredentials()) {
			const tempApp = await this.createApp(`misskey-temp-${Date.now()}`);
			if (tempApp) {
				console.log('Created temporary Cloudflare Calls app:', tempApp.appId);
				return tempApp;
			}
		}

		return null;
	}

	/**
	 * Get ICE servers configuration
	 * Priority: Always start with free STUN server
	 * Fallback: SFU TURN servers (requires createSession call)
	 */
	@bindThis
	public getIceServers(): RTCIceServer[] {
		// Always prioritize free STUN server to reduce bandwidth
		return [
			{
				urls: [CloudflareCallsService.STUN_SERVER],
			},
		];
	}

	/**
	 * Create a new session for WebRTC connection
	 * @see https://developers.cloudflare.com/realtime/sfu/https-api/
	 */
	@bindThis
	public async createSession(appId: string, appSecret: string): Promise<{
		sessionId: string;
	} | null> {
		if (!this.isEnabled()) {
			return null;
		}

		try {
			const url = `${this.getBaseUrl(appId)}/sessions/new`;

			const response = await this.httpRequestService.send(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${appSecret}`,
				},
				timeout: 30000,
			});

			const data = await response.json() as any;

			return {
				sessionId: data.sessionId,
			};
		} catch (error) {
			console.error('Failed to create Cloudflare Calls session:', error);
			return null;
		}
	}

	/**
	 * Add a new track to a session
	 * @see https://developers.cloudflare.com/realtime/sfu/https-api/
	 */
	@bindThis
	public async addTrack(
		appId: string,
		appSecret: string,
		sessionId: string,
		sessionDescription: RTCSessionDescriptionInit,
		tracks: Array<{ location: 'local' | 'remote'; mid?: string; trackName: string; sessionId?: string }>,
	): Promise<{
		sessionDescription: RTCSessionDescriptionInit;
		tracks: Array<{ trackName: string; mid?: string; sessionId?: string; errorCode?: string; errorDescription?: string }>;
		hasErrors?: boolean;
		hasRetryableTrackError?: boolean;
	} | null> {
		if (!this.isEnabled()) {
			return null;
		}

		if (!sessionDescription || !sessionDescription.type || !sessionDescription.sdp) {
			console.error('Invalid session description:', sessionDescription);
			return null;
		}

		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.error('Invalid tracks array:', tracks);
			return null;
		}

		try {
			const url = `${this.getBaseUrl(appId)}/sessions/${sessionId}/tracks/new`;

			const requestBody = {
				sessionDescription,
				tracks,
			};

			const response = await this.httpRequestService.send(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${appSecret}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
				timeout: 30000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});

			const data = await response.json() as any;

			if (!response.ok) {
				if (response.status === 410 && data?.errorCode === 'session_error') {
					return {
						sessionDescription: { type: 'answer', sdp: '' } as RTCSessionDescriptionInit,
						tracks: [{
							trackName: '',
							errorCode: data.errorCode,
							errorDescription: data.errorDescription,
						}],
						hasErrors: true,
						hasRetryableTrackError: false,
					};
				}

				if (response.status === 425 && data?.errorCode === 'session_error') {
					return {
						sessionDescription: { type: 'answer', sdp: '' } as RTCSessionDescriptionInit,
						tracks: [{
							trackName: '',
							errorCode: data.errorCode,
							errorDescription: data.errorDescription,
						}],
						hasErrors: true,
						hasRetryableTrackError: true,
					};
				}

				return null;
			}

			let hasErrors = false;
			let hasRetryableTrackError = false;
			if (data?.tracks && Array.isArray(data.tracks)) {
				const tracksWithErrors = data.tracks.filter((t: any) => t.errorCode);
				if (tracksWithErrors.length > 0) {
					hasErrors = true;
					const retryableErrors = ['empty_track_error', 'not_found_track_error', 'transport_unavailable_error'];
					hasRetryableTrackError = tracksWithErrors.some((t: any) =>
						retryableErrors.includes(t.errorCode)
					);
				}
			}

			if (hasRetryableTrackError) {
				return {
					sessionDescription: data.sessionDescription || { type: 'answer', sdp: '' },
					tracks: data.tracks || [],
					hasErrors,
					hasRetryableTrackError,
				};
			}

			if (!data?.sessionDescription?.type || !data?.sessionDescription?.sdp) {
				console.error('Invalid response from Cloudflare Calls:', JSON.stringify(data, null, 2));
				return null;
			}

			return {
				sessionDescription: data.sessionDescription,
				tracks: data.tracks || [],
				hasErrors,
				hasRetryableTrackError: false,
			};
		} catch (error) {
			console.error('Failed to add track to Cloudflare Calls session:', error);
			return null;
		}
	}

	/**
	 * Renegotiate a session (update tracks)
	 * @see https://developers.cloudflare.com/realtime/sfu/https-api/
	 */
	@bindThis
	public async renegotiateSession(
		appId: string,
		appSecret: string,
		sessionId: string,
		sessionDescription: RTCSessionDescriptionInit,
	): Promise<{ sessionDescription: RTCSessionDescriptionInit } | null> {
		if (!this.isEnabled()) {
			return null;
		}

		try {
			const url = `${this.getBaseUrl(appId)}/sessions/${sessionId}/renegotiate`;

			const response = await this.httpRequestService.send(url, {
				method: 'PUT',
				headers: {
					'Authorization': `Bearer ${appSecret}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ sessionDescription }),
			});

			const data = await response.json() as any;

			return {
				sessionDescription: data.sessionDescription,
			};
		} catch (error) {
			console.error('Failed to renegotiate Cloudflare Calls session:', error);
			return null;
		}
	}

	/**
	 * Close a track in a session
	 * @see https://developers.cloudflare.com/realtime/sfu/https-api/
	 */
	@bindThis
	public async closeTrack(
		appId: string,
		appSecret: string,
		sessionId: string,
		trackName: string,
	): Promise<boolean> {
		if (!this.isEnabled()) {
			return false;
		}

		try {
			const url = `${this.getBaseUrl(appId)}/sessions/${sessionId}/tracks/close`;

			await this.httpRequestService.send(url, {
				method: 'PUT',
				headers: {
					'Authorization': `Bearer ${appSecret}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ tracks: [{ trackName }] }),
			});

			return true;
		} catch (error) {
			console.error('Failed to close track in Cloudflare Calls session:', error);
			return false;
		}
	}

	/**
	 * Get session information
	 * @see https://developers.cloudflare.com/realtime/sfu/https-api/
	 */
	@bindThis
	public async getSessionInfo(
		appId: string,
		appSecret: string,
		sessionId: string,
	): Promise<{
		sessionId: string;
		tracks: Array<{ trackName: string; mid: string }>;
	} | null> {
		if (!this.isEnabled()) {
			return null;
		}

		try {
			const url = `${this.getBaseUrl(appId)}/sessions/${sessionId}`;

			const response = await this.httpRequestService.send(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${appSecret}`,
					'Content-Type': 'application/json',
				},
				timeout: 5000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});

			if (response.status === 410) {
				return null;
			}

			if (!response.ok) {
				return null;
			}

			const data = await response.json() as any;

			return {
				sessionId: data.sessionId,
				tracks: data.tracks,
			};
		} catch (error) {
			console.error('Failed to get Cloudflare Calls session info:', error);
			return null;
		}
	}
}
