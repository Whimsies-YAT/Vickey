/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, watch, version as vueVersion } from 'vue';
import { compareVersions } from 'compare-versions';
import { version, lang, apiUrl, isSafeMode } from '@@/js/config.js';
import defaultLightTheme from '@@/themes/_light.json5';
import defaultDarkTheme from '@@/themes/_dark.json5';
import { storeBootloaderErrors } from '@@/js/store-boot-errors';
import type { App } from 'vue';
import widgets from '@/widgets/index.js';
import directives from '@/directives/index.js';
import components from '@/components/index.js';
import { applyTheme } from '@/theme.js';
import { isDeviceDarkmode } from '@/utility/is-device-darkmode.js';
import { updateI18n, i18n } from '@/i18n.js';
import { refreshCurrentAccount, login } from '@/accounts.js';
import { store } from '@/store.js';
import { fetchInstance, instance } from '@/instance.js';
import { deviceKind, updateDeviceKind } from '@/utility/device-kind.js';
import { reloadChannel } from '@/utility/unison-reload.js';
import { getUrlWithoutLoginId } from '@/utility/login-id.js';
import { getAccountFromId } from '@/utility/get-account-from-id.js';
import { deckStore } from '@/ui/deck/deck-store.js';
import { analytics, initAnalytics } from '@/analytics.js';
import { miLocalStorage } from '@/local-storage.js';
import { fetchCustomEmojis } from '@/custom-emojis.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { launchPlugins } from '@/plugin.js';

export async function common(createVue: () => Promise<App<Element>>) {
	console.info(`Vickey v${version}-Vickey_fork`);

	const getBrowserFamily = () => {
		const ua = navigator.userAgent;
		if (ua.includes("Firefox")) {
			return "gecko";
		} else if (ua.includes("Chrome") || ua.includes("Edg") || ua.includes("OPR")) {
			return "chromium";
		} else if (ua.includes("Safari")) {
			return "safari";
		}
		return "unknown";
	};

	const getExtensionScheme = (family) => {
		switch (family) {
			case "chromium":
				return "chrome-extension";
			case "gecko":
				return "moz-extension";
			case "safari":
				return "safari-extension"; // Confirmation required
			default:
				return "";
		}
	};

	const checkExtension = async (scheme, extensionId, resourcePath) => {
		const extensionUrl = `${scheme}://${extensionId}/${resourcePath}`;
		try {
			const response = await window.fetch(extensionUrl, { method: "HEAD" });
			if (response.status === 200) {
				return true;
			}
			return false;
		} catch (error) {
			return false;
		}
	};

	// Because it causes crashes, prohibit the following plugins from running with Misskey, noting the difference between download sources.
	const prohibitedExtensions = {
		chromium: [
			{ extensionId: "apenkfbbpmhihehmihndmmcdanacolnh", resourcePath: "inpage.js", name: "SafePal Edge" },
			{ extensionId: "lgmpcpglpngdoalbgeoldeajfclnhafa", resourcePath: "inpage.js", name: "SafePal Chrome" },
			{ extensionId: "onepmapfbjohnegdmfhndpefjkppbjkm", resourcePath: "popup.html", name: "SuperCopy Chrome" },
			{ extensionId: "adgoabeggndbnkchckgniickhhiejbpn", resourcePath: "popup.html", name: "SuperCopy Edge" },
		],
		gecko: [
			{ extensionId: "7b88262b-985e-4f6d-b4f1-25a43e96dbf8", resourcePath: "inpage.js", name: "SafePal Mozilla" },
		],
		safari: [
		],
	};

	interface ExtensionInfo {
		id: string;
		name: string;
		url: string;
	}

	const checkExtensionsInList = async () => {
		const family = getBrowserFamily();
		const scheme = getExtensionScheme(family);
		const list = prohibitedExtensions[family] || [];
		const detectedExtensions: ExtensionInfo[] = [];

		for (const ext of list) {
			const exists = await checkExtension(scheme, ext.extensionId, ext.resourcePath);
			if (exists) {
				detectedExtensions.push({
					id: ext.extensionId,
					name: ext.name,
					url: `${scheme}://${ext.extensionId}/${ext.resourcePath}`,
				});
			}
		}
		return detectedExtensions;
	};

	/*
	 * [Deprecated] Extension detection block
	 *
	 * Context:
	 *   - Originally added to detect certain browser extensions that could cause the frontend to crash.
	 *   - The bug has since been fixed.
	 *
	 * Action:
	 *   - Code commented out to avoid confusion, retained only as reference.
	 *   - May be helpful if a similar issue arises in the future.
	 */
	if (_DEV_) {
		checkExtensionsInList()
			.then((detected) => {
				if (detected.length > 0) {
					let errorMsg = "[Detection Error] The following prohibited extensions have been detected: \n";
					detected.forEach((ext) => {
						errorMsg += `- ${ext.name}\n`;
					});
					console.error(errorMsg);
				} else {
					console.log("No prohibited extensions were detected.");
				}
			})
			.catch((error) => {
				console.error(error.message);
			});
	}

	if (_DEV_) {
		console.warn('Development mode!!!');

		console.info(`vue ${vueVersion}`);

		window.addEventListener('error', event => {
			console.error(event);
			/*
			alert({
				type: 'error',
				title: 'DEV: Unhandled error',
				text: event.message
			});
			*/
		});

		window.addEventListener('unhandledrejection', event => {
			console.error(event);
			/*
			alert({
				type: 'error',
				title: 'DEV: Unhandled promise rejection',
				text: event.reason
			});
			*/
		});
	}

	let isClientUpdated = false;

	//#region クライアントが更新されたかチェック
	const lastVersion = miLocalStorage.getItem('lastVersion');
	if (lastVersion !== version) {
		miLocalStorage.setItem('lastVersion', version);

		try { // 変なバージョン文字列来るとcompareVersionsでエラーになるため
			if (lastVersion != null && compareVersions(version, lastVersion) === 1) {
				isClientUpdated = true;
			}
		} catch (err) { /* empty */ }
	}
	//#endregion

	//#region Detect language & fetch translations
	storeBootloaderErrors({ ...i18n.ts._bootErrors, reload: i18n.ts.reload });

	if (import.meta.hot) {
		import.meta.hot.on('locale-update', async (updatedLang: string) => {
			console.info(`Locale updated: ${updatedLang}`);
			if (updatedLang === lang) {
				await new Promise(resolve => {
					window.setTimeout(resolve, 500);
				});
				// fetch with cache: 'no-store' to ensure the latest locale is fetched
				await window.fetch(`/assets/locales/${lang}.${version}.json`, { cache: 'no-store' }).then(async res => res.status === 200 && await res.text());
				window.location.reload();
			}
		});
	}
	//#endregion

	// タッチデバイスでCSSの:hoverを機能させる
	window.document.addEventListener('touchend', () => {}, { passive: true });

	// URLに#pswpを含む場合は取り除く
	if (window.location.hash === '#pswp') {
		window.history.replaceState(null, '', window.location.href.replace('#pswp', ''));
	}

	// 一斉リロード
	reloadChannel.addEventListener('message', path => {
		if (path !== null) window.location.href = path;
		else window.location.reload();
	});

	// If mobile, insert the viewport meta tag
	if (['smartphone', 'tablet'].includes(deviceKind)) {
		const viewport = window.document.getElementsByName('viewport').item(0);
		viewport.setAttribute('content',
			`${viewport.getAttribute('content')}, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`);
	}

	//#region Set lang attr
	const html = window.document.documentElement;
	html.setAttribute('lang', lang);
	//#endregion

	await store.ready;
	await deckStore.ready;

	const fetchInstanceMetaPromise = fetchInstance();

	fetchInstanceMetaPromise.then(() => {
		miLocalStorage.setItem('v', instance.version);
	});

	//#region loginId
	const params = new URLSearchParams(window.location.search);
	const loginId = params.get('loginId');

	if (loginId) {
		const target = getUrlWithoutLoginId(window.location.href);

		if (!$i || $i.id !== loginId) {
			const account = await getAccountFromId(loginId);
			if (account) {
				await login(account.token, target);
			}
		}

		window.history.replaceState({ misskey: 'loginId' }, '', target);
	}
	//#endregion

	//#region Sync dark mode
	if (prefer.s.syncDeviceDarkMode) {
		store.set('darkMode', isDeviceDarkmode());
	}

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (mql) => {
		if (prefer.s.syncDeviceDarkMode) {
			store.set('darkMode', mql.matches);
		}
	});
	//#endregion

	// NOTE: この処理は必ずクライアント更新チェック処理より後に来ること(テーマ再構築のため)
	// NOTE: この処理は必ずダークモード判定処理より後に来ること(初回のテーマ適用のため)
	// see: https://github.com/misskey-dev/misskey/issues/16562
	watch(store.r.darkMode, (darkMode) => {
		const theme = (() => {
			if (darkMode) {
				return isSafeMode ? defaultDarkTheme : (prefer.s.darkTheme ?? defaultDarkTheme);
			} else {
				return isSafeMode ? defaultLightTheme : (prefer.s.lightTheme ?? defaultLightTheme);
			}
		})();

		applyTheme(theme);
	}, { immediate: true });

	window.document.documentElement.dataset.colorScheme = store.s.darkMode ? 'dark' : 'light';

	if (!isSafeMode) {
		const darkTheme = prefer.model('darkTheme');
		const lightTheme = prefer.model('lightTheme');

		watch(darkTheme, (theme) => {
			if (store.s.darkMode) {
				applyTheme(theme ?? defaultDarkTheme);
			}
		});

		watch(lightTheme, (theme) => {
			if (!store.s.darkMode) {
				applyTheme(theme ?? defaultLightTheme);
			}
		});

		fetchInstanceMetaPromise.then(() => {
			// TODO: instance.defaultLightTheme/instance.defaultDarkThemeが不正な形式だった場合のケア
			if (prefer.s.lightTheme == null && instance.defaultLightTheme != null) prefer.commit('lightTheme', JSON.parse(instance.defaultLightTheme));
			if (prefer.s.darkTheme == null && instance.defaultDarkTheme != null) prefer.commit('darkTheme', JSON.parse(instance.defaultDarkTheme));
		});
	}

	watch(prefer.r.overridedDeviceKind, (kind) => {
		updateDeviceKind(kind);
	}, { immediate: true });

	watch(prefer.r.useBlurEffectForModal, v => {
		window.document.documentElement.style.setProperty('--MI-modalBgFilter', v ? 'blur(4px)' : 'none');
	}, { immediate: true });

	watch(prefer.r.useBlurEffect, v => {
		if (v) {
			window.document.documentElement.style.removeProperty('--MI-blur');
		} else {
			window.document.documentElement.style.setProperty('--MI-blur', 'none');
		}
	}, { immediate: true });

	// Keep screen on
	const onVisibilityChange = () => window.document.addEventListener('visibilitychange', () => {
		if (window.document.visibilityState === 'visible') {
			navigator.wakeLock.request('screen');
		}
	});
	if (prefer.s.keepScreenOn && 'wakeLock' in navigator) {
		navigator.wakeLock.request('screen')
			.then(onVisibilityChange)
			.catch(() => {
				// On WebKit-based browsers, user activation is required to send wake lock request
				// https://webkit.org/blog/13862/the-user-activation-api/
				window.document.addEventListener(
					'click',
					() => navigator.wakeLock.request('screen').then(onVisibilityChange),
					{ once: true },
				);
			});
	}

	if (prefer.s.makeEveryTextElementsSelectable) {
		window.document.documentElement.classList.add('forceSelectableAll');
	}

	//#region Fetch user
	if ($i && $i.token) {
		if (_DEV_) {
			console.log('account cache found. refreshing...');
		}

		refreshCurrentAccount();
	}
	//#endregion

	try {
		await fetchCustomEmojis();
	} catch (err) { /* empty */ }

	// analytics
	fetchInstanceMetaPromise.then(async () => {
		await initAnalytics(instance);

		if ($i) {
			analytics.identify($i.id);
		}

		analytics.page({
			path: window.location.pathname,
		});
	});

	const app = await createVue();

	if (_DEV_) {
		app.config.performance = true;
	}

	widgets(app);
	directives(app);
	components(app);

	// https://github.com/misskey-dev/misskey/pull/8575#issuecomment-1114239210
	// なぜか2回実行されることがあるため、mountするdivを1つに制限する
	const rootEl = ((): HTMLElement => {
		const MISSKEY_MOUNT_DIV_ID = 'misskey_app';

		const currentRoot = window.document.getElementById(MISSKEY_MOUNT_DIV_ID);

		if (currentRoot) {
			console.warn('multiple import detected');
			return currentRoot;
		}

		const root = window.document.createElement('div');
		root.id = MISSKEY_MOUNT_DIV_ID;
		window.document.body.appendChild(root);
		return root;
	})();

	if (instance.sentryForFrontend) {
		const initSentryIsolated = async () => {
			try {
				const setupSentry = async () => {
					try {
						const Sentry = await import('@sentry/vue').catch(e => {
							console.warn('Failed to load Sentry module:', e);
							return null;
						});

						if (!Sentry) return null;

						try {
							const sentryInstance = Sentry.init({
								app,
								beforeSend(event) {
									try {
										const error = event.exception?.values?.[0];
										if (error?.stacktrace?.frames?.some(frame => frame.filename?.includes('chrome-extension://'))) {
											return null;
										}
										return event;
									} catch (filterError) {
										console.warn('Sentry beforeSend filter failed:', filterError);
										return null;
									}
								},
								integrations: [
									...(instance.sentryForFrontend.vueIntegration !== undefined
										? [(() => {
											try {
												return Sentry.vueIntegration(instance.sentryForFrontend.vueIntegration ?? undefined);
											} catch (e) {
												console.warn('Sentry Vue integration failed:', e);
												return null;
											}
										})()].filter(Boolean)
										: []),
									...(instance.sentryForFrontend.browserTracingIntegration !== undefined
										? [(() => {
											try {
												return Sentry.browserTracingIntegration(instance.sentryForFrontend.browserTracingIntegration ?? undefined);
											} catch (e) {
												console.warn('Sentry browser tracing integration failed:', e);
												return null;
											}
										})()].filter(Boolean)
										: []),
									...(instance.sentryForFrontend.replayIntegration !== undefined
										? [(() => {
											try {
												return Sentry.replayIntegration(instance.sentryForFrontend.replayIntegration ?? undefined);
											} catch (e) {
												console.warn('Sentry replay integration failed:', e);
												return null;
											}
										})()].filter(Boolean)
										: []),
								].filter(Boolean),
								tracesSampleRate: instance.sentryForFrontend.tracesSampleRate ?? 0.2,
								replaysSessionSampleRate: instance.sentryForFrontend.replaysSessionSampleRate ?? 0.1,
								replaysOnErrorSampleRate: instance.sentryForFrontend.replaysOnErrorSampleRate ?? 0.5,
								...instance.sentryForFrontend.options,
							});

							const safeCapture = (exception, extras = {}) => {
								return new Promise((resolve) => {
									try {
										Sentry.captureException(exception, extras);
										resolve(true);
									} catch (e) {
										console.warn('Sentry capture failed:', e);
										resolve(false);
									}
								});
							};

							app.config.errorHandler = (error, vm, info) => {
								window.setTimeout(() => {
									safeCapture(error, { extra: { vm, info } }).catch(() => {});
								}, 0);
								console.error('Global Vue error handler:', error, info);
								return false;
							};

							const unhandledRejectionHandler = (event) => {
								if (event.preventDefault) {
									event.preventDefault();
								}

								window.setTimeout(() => {
									safeCapture(event.reason).catch(() => {});
								}, 0);
								console.error('Unhandled promise rejection (isolated):', event.reason);
							};

							window.addEventListener('unhandledrejection', unhandledRejectionHandler);

							return {
								cleanup: () => {
									try {
										window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
									} catch (e) {
										console.warn('Sentry cleanup failed:', e);
									}
								}
							};
						} catch (initError) {
							console.warn('Sentry initialization failed:', initError);
							return null;
						}
					} catch (setupError) {
						console.warn('Sentry setup completely failed:', setupError);
						return null;
					}
				};

				await new Promise(resolve => {
					window.setTimeout(async () => {
						try {
							await setupSentry();
						} catch (e) {
							console.warn('Fatal error in Sentry isolated context:', e);
						} finally {
							resolve(null);
						}
					}, 0);
				});
			} catch (rootError) {
				console.warn('Root Sentry isolation failed:', rootError);
			}
		};

		window.setTimeout(() => {
			initSentryIsolated().catch(err => {
				console.warn('Completely isolated Sentry init failed:', err);
			});
		}, 0);
	}

	try {
		await launchPlugins();
	} catch (error) {
		console.error('Failed to launch plugins:', error);
	}

	app.mount(rootEl);

	// boot.jsのやつを解除
	window.onerror = null;
	window.onunhandledrejection = null;

	removeSplash();

	//#region Self-XSS 対策メッセージ
	if (!_DEV_) {
		console.log(
			`%c${i18n.ts._selfXssPrevention.warning}`,
			'color: #f00; background-color: #ff0; font-size: 36px; padding: 4px;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.title}`,
			'color: #f00; font-weight: 900; font-family: "Hiragino Sans W9", "Hiragino Kaku Gothic ProN", sans-serif; font-size: 24px;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.description1}`,
			'font-size: 16px; font-weight: 700;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.description2}`,
			'font-size: 16px;',
			'font-size: 20px; font-weight: 700; color: #f00;',
		);
		console.log(i18n.tsx._selfXssPrevention.description3({ link: 'https://misskey-hub.net/docs/for-users/resources/self-xss/' }));
	}
	//#endregion

	return {
		isClientUpdated,
		lastVersion,
		app,
	};
}

function removeSplash() {
	const splash = window.document.getElementById('splash');
	if (splash) {
		splash.style.opacity = '0';
		splash.style.pointerEvents = 'none';

		// transitionendイベントが発火しない場合があるため
		window.setTimeout(() => {
			splash.remove();
		}, 1000);
	}
}
