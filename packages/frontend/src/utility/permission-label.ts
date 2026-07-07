/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

export function permissionLabel(permission: string): string {
	return (i18n.ts._permissions as Record<string, string | undefined>)[permission] ?? permission;
}
