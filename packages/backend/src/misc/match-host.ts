/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function matchHost(host: string | null, pattern: string): boolean {
	if (!host) return false;

	const normalizedHost = host.toLowerCase().trim();
	const normalizedPattern = pattern.toLowerCase().trim();

	if (normalizedPattern.startsWith('*')) {
		const suffix = normalizedPattern.slice(1);
		if (suffix.startsWith('.')) {
			const domain = suffix.slice(1);
			return normalizedHost === domain || normalizedHost.endsWith(suffix);
		}
		return normalizedHost.endsWith(suffix);
	}

	return normalizedHost === normalizedPattern;
}

export function matchHostPatterns(host: string | null, patterns: string[]): boolean {
	if (!host || patterns.length === 0) return false;

	return patterns.some(pattern => matchHost(host, pattern));
}
