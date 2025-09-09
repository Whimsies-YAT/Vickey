/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { misskeyApi } from '@/utility/misskey-api.js';
import { shouldRegenerateToken } from '@/utility/token-check.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { store } from '@/store.js';
import { host } from '@@/js/config.js';

export async function checkAndRegenerateToken(): Promise<boolean> {
	if (!$i?.token) {
		return false;
	}

	if (!shouldRegenerateToken($i.token)) {
		return false;
	}

	console.log('Old token format detected');

	try {
		const frontendResult = await os.confirm({
			type: 'warning',
			title: i18n.ts._tokenMigration.oldTokenFormatDetected,
			text: i18n.ts._tokenMigration.securityAlert,
		});

		if (frontendResult.canceled) {
			os.toast(i18n.ts._tokenMigration.declined);
			return false;
		}

		const auth = await os.authenticateDialog();
		if (auth.canceled) {
			return false;
		}

		const result = await misskeyApi('i/regenerate-token', {
			password: auth.result.password,
			current: true,
		});

		if (result && typeof result === 'object' && 'token' in result) {
			// Update all token references immediately
			const newToken = result.token;
			$i.token = newToken;
			miLocalStorage.setItem('account', JSON.stringify($i));
			// Update token in multi-user storage
			store.set('accountTokens', { ...store.s.accountTokens, [host + '/' + $i.id]: newToken });
			// Update account info in store to ensure consistency
			store.set('accountInfos', { ...store.s.accountInfos, [host + '/' + $i.id]: $i });
		}

		console.log('Token successfully regenerated');

		os.toast(i18n.ts._tokenMigration.succeeded);

		return true;
	} catch (error) {
		console.error('Failed to regenerate token:', error);

		await os.alert({
			type: 'error',
			title: i18n.ts._tokenMigration.error,
			text: i18n.ts._tokenMigration.errorText,
		});

		return false;
	}
}

export async function silentTokenRefresh(): Promise<boolean> {
	if (!$i?.token) {
		return false;
	}

	try {
		const result = await misskeyApi('i/regenerate-token');

		if (result && typeof result === 'object' && 'token' in result) {
			// Update all token references immediately
			const newToken = result.token;
			$i.token = newToken;
			miLocalStorage.setItem('account', JSON.stringify($i));
			// Update token in multi-user storage
			store.set('accountTokens', { ...store.s.accountTokens, [host + '/' + $i.id]: newToken });
			// Update account info in store to ensure consistency
			store.set('accountInfos', { ...store.s.accountInfos, [host + '/' + $i.id]: $i });
		}

		return true;
	} catch (error) {
		console.warn('Silent token refresh failed:', error);
		return false;
	}
}
