/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Check if a token is in the old native format (16 characters)
 */
export function isNativeToken(token: string): boolean {
	return token.length === 16;
}

/**
 * Determine if a token is old and needs to be regenerated
 */
export function shouldRegenerateToken(token: string): boolean {
	return isNativeToken(token);
}
