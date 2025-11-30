/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type RTCIceCredentialType = 'password' | 'oauth';

export interface RTCIceServer {
	urls: string | string[];
	username?: string;
	credential?: string;
	credentialType?: RTCIceCredentialType;
}

export type RTCSdpType = 'offer' | 'pranswer' | 'answer' | 'rollback';

export interface RTCSessionDescriptionInit {
	type: RTCSdpType;
	sdp?: string;
}
