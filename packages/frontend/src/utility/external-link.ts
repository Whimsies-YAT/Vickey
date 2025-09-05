/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { hostname } from '@@/js/config.js';

export function isExternalLink(url: string): boolean {
	try {
		const targetUrl = new URL(url);
		const currentHostname = hostname;

		const getMainDomain = (host: string): string => {
			const parts = host.split('.');
			if (parts.length >= 2) {
				return parts.slice(-2).join('.');
			}
			return host;
		};

		const targetMainDomain = getMainDomain(targetUrl.hostname);
		const currentMainDomain = getMainDomain(currentHostname);

		return targetMainDomain !== currentMainDomain;
	} catch {
		return false;
	}
}
