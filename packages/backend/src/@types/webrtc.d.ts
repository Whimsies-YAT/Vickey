/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

interface RTCIceServer {
	urls: string | string[];
	username?: string;
	credential?: string;
}

interface RTCSessionDescriptionInit {
	type: 'offer' | 'pranswer' | 'answer' | 'rollback';
	sdp?: string;
}
