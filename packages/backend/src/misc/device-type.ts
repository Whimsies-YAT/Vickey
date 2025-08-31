/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const MOBILE_REGEX = /mobile|android|iphone|ipad|ipod|blackberry|windows phone|webos|opera mini/i;
const DESKTOP_REGEX = /windows nt|macintosh|mac os x|linux|x11/i;

export function detectDeviceType(headers: any): 'M' | 'P' | 'C' | 'U' {
	const ua = headers?.['user-agent'] || headers?.['User-Agent'];

	if (!ua) return 'U';

	if (MOBILE_REGEX.test(ua)) return 'M';
	if (DESKTOP_REGEX.test(ua)) return 'P';

	return 'C';
}
