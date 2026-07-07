/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import type { App } from 'vue';
import type * as Misskey from 'misskey-js';

export async function initTelemetry(instance: Misskey.entities.MetaDetailed, app: App): Promise<void> {
	if (!instance.sentryForFrontend) return;

	const sentryConfig = instance.sentryForFrontend;

	const initSentryIsolated = async () => {
		try {
			const setupSentry = async () => {
				try {
					const Sentry = await import('@sentry/vue').catch(err => {
						console.warn('Failed to load Sentry module:', err);
						return null;
					});

					if (!Sentry) return;

					try {
						const integrations = [
							...(sentryConfig.vueIntegration !== undefined
								? [(() => {
									try {
										return Sentry.vueIntegration(sentryConfig.vueIntegration ?? undefined);
									} catch (err) {
										console.warn('Sentry Vue integration failed:', err);
										return null;
									}
								})()].filter((x): x is NonNullable<typeof x> => x !== null)
								: []),
							...(sentryConfig.browserTracingIntegration !== undefined
								? [(() => {
									try {
										return Sentry.browserTracingIntegration(sentryConfig.browserTracingIntegration ?? undefined);
									} catch (err) {
										console.warn('Sentry browser tracing integration failed:', err);
										return null;
									}
								})()].filter((x): x is NonNullable<typeof x> => x !== null)
								: []),
							...(sentryConfig.replayIntegration !== undefined
								? [(() => {
									try {
										return Sentry.replayIntegration(sentryConfig.replayIntegration ?? undefined);
									} catch (err) {
										console.warn('Sentry replay integration failed:', err);
										return null;
									}
								})()].filter((x): x is NonNullable<typeof x> => x !== null)
								: []),
						];

						const sentryOptions = (sentryConfig.options ?? {}) as Record<string, unknown>;

						Sentry.init({
							app,
							beforeSend(event) {
								try {
									const error = event.exception?.values?.[0];
									if (error?.stacktrace?.frames?.some(frame => frame.filename?.includes('chrome-extension://'))) {
										return null;
									}
									return event;
								} catch (err) {
									console.warn('Sentry beforeSend filter failed:', err);
									return null;
								}
							},
							integrations,
							tracesSampleRate: sentryOptions.tracesSampleRate as number | undefined ?? 0.2,
							...(sentryConfig.browserTracingIntegration !== undefined ? {
								tracePropagationTargets: [apiUrl],
							} : {}),
							replaysSessionSampleRate: sentryOptions.replaysSessionSampleRate as number | undefined ?? 0.1,
							replaysOnErrorSampleRate: sentryOptions.replaysOnErrorSampleRate as number | undefined ?? 0.5,
							...sentryConfig.options,
						});

						const safeCapture = (exception: unknown, extras: Parameters<typeof Sentry.captureException>[1] = {}) => {
							return new Promise<boolean>((resolve) => {
								try {
									Sentry.captureException(exception, extras);
									resolve(true);
								} catch (err) {
									console.warn('Sentry capture failed:', err);
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

						const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
							event.preventDefault?.();

							window.setTimeout(() => {
								safeCapture(event.reason).catch(() => {});
							}, 0);
							console.error('Unhandled promise rejection (isolated):', event.reason);
						};

						window.addEventListener('unhandledrejection', unhandledRejectionHandler);
					} catch (err) {
						console.warn('Sentry initialization failed:', err);
					}
				} catch (err) {
					console.warn('Sentry setup completely failed:', err);
				}
			};

			await new Promise(resolve => {
				window.setTimeout(async () => {
					try {
						await setupSentry();
					} catch (err) {
						console.warn('Fatal error in Sentry isolated context:', err);
					} finally {
						resolve(null);
					}
				}, 0);
			});
		} catch (err) {
			console.warn('Root Sentry isolation failed:', err);
		}
	};

	window.setTimeout(() => {
		initSentryIsolated().catch(err => {
			console.warn('Completely isolated Sentry init failed:', err);
		});
	}, 0);
}
