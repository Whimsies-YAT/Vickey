/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { cloudBackup } from '@/preferences/utility.js';
import { store } from '@/store.js';
import { waiting } from '@/os.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { clear } from '@/utility/idb-proxy.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export async function signout() {
	if (!$i) return;

	waiting();

	try {
		if (store.s.enablePreferencesAutoCloudBackup) {
			await cloudBackup();
		}
	} catch (err) {
		console.error('Failed to backup preferences:', err);
	}

	try {
		await misskeyApi('i/sign-out');
	} catch (err) {
		console.warn('Failed to invalidate session on server:', err);
	}

	localStorage.clear();

	const idbAbortController = new AbortController();
	const timeout = window.setTimeout(() => idbAbortController.abort(), 3000); // Reduced from 5000ms to 3000ms

	try {
		await Promise.race([
			Promise.all([
				...[
					'MisskeyClient',
				].map(name => new Promise<void>((resolve) => {
					try {
						const delidb = indexedDB.deleteDatabase(name);
						delidb.onsuccess = () => resolve();
						delidb.onerror = () => resolve();
						delidb.onblocked = () => resolve();
					} catch (e) {
						console.error(`Error deleting IndexedDB '${name}':`, e);
						resolve();
					}
				})),
				clear().catch(err => {
					console.error('Failed to clear IDB keyval-store:', err);
				}),
			]),
			new Promise((_, reject) => {
				idbAbortController.signal.addEventListener('abort', () => {
					console.warn('IndexedDB cleanup timed out, continuing with signout');
					reject(new Error('IDB operation timed out'));
				});
			}),
		]);
	} catch (err) {
		console.warn('IndexedDB cleanup error, continuing with signout:', err);
	} finally {
		window.clearTimeout(timeout);
	}

	//#region Remove service worker registration
	try {
		if (navigator.serviceWorker && navigator.serviceWorker.controller) {
			const swTimeout = window.setTimeout(() => {
				console.warn('Service worker deregistration timed out, continuing with signout');
				finishSignout();
			}, 2000);

			try {
				const registration = await Promise.race([
					navigator.serviceWorker.ready,
					new Promise((_, reject) => window.setTimeout(() => reject(new Error('SW ready timeout')), 1000)),
				]) as ServiceWorkerRegistration;

				try {
					const push = await Promise.race([
						registration.pushManager.getSubscription(),
						new Promise((_, reject) => window.setTimeout(() => reject(new Error('Push subscription timeout')), 1000)),
					]) as PushSubscription;

					if (push) {
						try {
							await Promise.race([
								window.fetch(`${apiUrl}/sw/unregister`, {
									method: 'POST',
									body: JSON.stringify({
										i: $i.token,
										endpoint: push.endpoint,
									}),
									headers: {
										'Content-Type': 'application/json',
									},
								}),
								new Promise((_, reject) => window.setTimeout(() => reject(new Error('Fetch timeout')), 1000)),
							]);
						} catch (err) {
							console.warn('Failed to unregister push subscription:', err);
						}
					}
				} catch (err) {
					console.warn('Failed to get push subscription:', err);
				}
			} catch (err) {
				console.warn('Service worker not ready:', err);
			}

			try {
				const registrations = await Promise.race([
					navigator.serviceWorker.getRegistrations(),
					new Promise((_, reject) => window.setTimeout(() => reject(new Error('Get registrations timeout')), 1000)),
				]) as ServiceWorkerRegistration[];

				await Promise.all(registrations.map(registration =>
					Promise.race([
						registration.unregister(),
						new Promise((_, reject) => window.setTimeout(() => reject(new Error('Unregister timeout')), 1000)),
					]).catch(err => console.warn('Failed to unregister a service worker:', err)),
				));
			} catch (err) {
				console.warn('Failed to get service worker registrations:', err);
			}

			window.clearTimeout(swTimeout);
			finishSignout();
		} else {
			finishSignout();
		}
	} catch (err) {
		console.warn('Service worker cleanup error:', err);
		finishSignout();
	}
	//#endregion
}

function finishSignout() {
	unisonReload('/');
}
