/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import { compareVersions } from 'compare-versions';
import { isSafeMode } from '@@/js/config.js';
import * as Misskey from 'misskey-js';
import type { Parser, Interpreter, values, utils as utils_TypeReferenceOnly } from '@syuilo/aiscript';
import type { FormWithDefault } from '@/utility/form.js';
import { genId } from '@/utility/id.js';
import { store } from '@/store.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

export type Plugin = {
	installId: string;
	name: string;
	active: boolean;
	config?: FormWithDefault;
	configData: Record<string, any>;
	src: string | null;
	version: string;
	author?: string;
	description?: string;
	permissions?: string[];
};

export type AiScriptPluginMeta = {
	name: string;
	version: string;
	author: string;
	description?: string;
	permissions?: string[];
	config?: Record<string, any>;
};

let _parser: Parser | null = null;

async function getParser(): Promise<Parser> {
	const { Parser } = await import('@syuilo/aiscript');
	_parser ??= new Parser();
	return _parser;
}

export function isSupportedAiScriptVersion(version: string): boolean {
	try {
		return (compareVersions(version, '0.12.0') >= 0);
	} catch (err) {
		return false;
	}
}

export async function parsePluginMeta(code: string): Promise<AiScriptPluginMeta> {
	if (!code) {
		throw new Error('code is required');
	}

	const { Interpreter, utils } = await import('@syuilo/aiscript');

	const lv = utils.getLangVersion(code);
	if (lv == null) {
		throw new Error('No language version annotation found');
	} else if (!isSupportedAiScriptVersion(lv)) {
		throw new Error(`Aiscript version '${lv}' is not supported`);
	}

	let ast;
	try {
		const parser = await getParser();
		ast = parser.parse(code);
	} catch (err) {
		throw new Error('Aiscript syntax error');
	}

	const meta = Interpreter.collectMetadata(ast);
	if (meta == null) {
		throw new Error('Meta block not found');
	}

	const metadata = meta.get(null);
	if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new Error('Metadata not found or invalid');
	}

	const { name, version, author, description, permissions, config } = metadata;

	if (name == null || version == null || author == null) {
		throw new Error('Required property not found');
	}

	return {
		name: name as string,
		version: version as string,
		author: author as string,
		description: description as string | undefined,
		permissions: permissions as string[] | undefined,
		config: config as Record<string, any> | undefined,
	};
}

export async function authorizePlugin(plugin: Plugin) {
	if (plugin.permissions == null || plugin.permissions.length === 0) return;
	if (Object.hasOwn(store.s.pluginTokens, plugin.installId)) return;

	const token = await new Promise<string>(async (res, rej) => {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkTokenGenerateWindow.vue').then(x => x.default), {
			title: i18n.ts.tokenRequested,
			information: i18n.ts.pluginTokenRequestedDescription,
			initialName: plugin.name,
			initialPermissions: plugin.permissions as typeof Misskey.permissions[number][],
		}, {
			done: async result => {
				const { name, permissions } = result;
				const { token } = await misskeyApi('miauth/gen-token', {
					session: null,
					name: name,
					permission: permissions,
				});
				res(token);
			},
			closed: () => dispose(),
		});
	});

	store.set('pluginTokens', {
		...store.s.pluginTokens,
		[plugin.installId]: token,
	});
}

export async function installPlugin(code: string, meta?: AiScriptPluginMeta) {
	if (!code) return;

	let realMeta: AiScriptPluginMeta;
	if (!meta) {
		realMeta = await parsePluginMeta(code);
	} else {
		realMeta = meta;
	}

	if (prefer.s.plugins.some(x => x.name === realMeta.name)) {
		throw new Error('Plugin already installed');
	}

	const installId = genId();

	const plugin = {
		...realMeta,
		config: realMeta.config ?? {},
		installId,
		active: true,
		configData: {},
		src: code,
	};

	prefer.commit('plugins', prefer.s.plugins.concat(plugin));

	await authorizePlugin(plugin);

	await launchPlugin(installId);
}

export async function uninstallPlugin(plugin: Plugin) {
	abortPlugin(plugin);
	prefer.commit('plugins', prefer.s.plugins.filter(x => x.installId !== plugin.installId));

	Object.keys(window.localStorage).forEach(key => {
		if (key.startsWith('aiscript:plugins:' + plugin.installId)) {
			window.localStorage.removeItem(key);
		}
	});

	if (Object.hasOwn(store.s.pluginTokens, plugin.installId)) {
		await os.apiWithDialog('i/revoke-token', {
			token: store.s.pluginTokens[plugin.installId],
		});
		const pluginTokens = { ...store.s.pluginTokens };
		delete pluginTokens[plugin.installId];
		store.set('pluginTokens', pluginTokens);
	}
}

// Worker references instead of direct Interpreter instances
type PluginWorkerContext = {
	worker: Worker;
	handlers: Map<string, { type: string; data: any }>;
};

const pluginContexts = new Map<Plugin['installId'], PluginWorkerContext>();

export const pluginLogs = ref(new Map<Plugin['installId'], {
	at: number;
	message: string;
	isSystem?: boolean;
	isError?: boolean;
}[]>());

type HandlerDef = {
	post_form_action: {
		title: string,
		handler: <T>(form: T, update: (key: unknown, value: unknown) => void) => void | Promise<void>;
	};
	user_action: {
		title: string,
		handler: (user: Misskey.entities.UserDetailed) => void | Promise<void>;
	};
	note_action: {
		title: string,
		handler: (note: Misskey.entities.Note) => void | Promise<void>;
	};
	note_view_interruptor: {
		handler: (note: Misskey.entities.Note) => Misskey.entities.Note | null | Promise<Misskey.entities.Note | null>;
	};
	note_post_interruptor: {
		handler: (note: FIXME) => unknown | Promise<unknown>;
	};
	page_view_interruptor: {
		handler: (page: Misskey.entities.Page) => Misskey.entities.Page | Promise<Misskey.entities.Page>;
	};
};

type PluginHandler<K extends keyof HandlerDef> = {
	pluginInstallId: string;
	type: K;
	ctx: HandlerDef[K];
};

let pluginHandlers: PluginHandler<keyof HandlerDef>[] = [];

function addPluginHandler<K extends keyof HandlerDef>(installId: Plugin['installId'], type: K, ctx: PluginHandler<K>['ctx']) {
	pluginLogs.value.get(installId)!.push({
		at: Date.now(),
		isSystem: true,
		message: `Handler registered: ${type}`,
	});
	pluginHandlers.push({ pluginInstallId: installId, type, ctx });
}

export function launchPlugins() {
	return Promise.all(prefer.s.plugins.map(plugin => {
		if (plugin.active) {
			return launchPlugin(plugin.installId);
		} else {
			return Promise.resolve();
		}
	}));
}

async function launchPlugin(id: Plugin['installId']): Promise<void> {
	if (isSafeMode) return;
	const plugin = prefer.s.plugins.find(x => x.installId === id);
	if (!plugin) return;

	// 後方互換性のため
	if (plugin.src == null) return;

	pluginLogs.value.set(plugin.installId, []);

	function systemLog(message: string, isError = false): void {
		pluginLogs.value.get(plugin!.installId)?.push({
			at: Date.now(),
			isSystem: true,
			message,
			isError,
		});
	}

	systemLog('Starting plugin in isolated worker...');

	await authorizePlugin(plugin);

	return new Promise((resolve, reject) => {
		try {
			const worker = new Worker(
				new URL('./workers/plugin-worker.ts', import.meta.url),
				{ type: 'module', name: `plugin-${plugin.installId}` }
			);

			const context: PluginWorkerContext = {
				worker,
				handlers: new Map(),
			};
			pluginContexts.set(plugin.installId, context);

			worker.onmessage = async (event) => {
				const msg = event.data;

				switch (msg.type) {
					case 'ready':
						systemLog('Worker ready, initializing plugin...');

						const baseEnv = await createPluginEnvForWorker({
							plugin: plugin,
							storageKey: 'plugins:' + plugin.installId,
							token: store.s.pluginTokens[plugin.installId],
						});

						worker.postMessage({
							type: 'init',
							pluginId: plugin.installId,
							code: plugin.src,
							env: baseEnv,
						});
						break;

					case 'output':
						pluginLogs.value.get(plugin.installId)?.push({
							at: Date.now(),
							message: msg.value,
						});
						break;

					case 'systemLog':
						systemLog(msg.message, msg.isError);
						break;

					case 'error':
						pluginLogs.value.get(plugin.installId)?.push({
							at: Date.now(),
							message: msg.error,
							isError: true,
						});
						break;

					case 'complete':
						console.info('Plugin started:', plugin.name, 'v' + plugin.version);
						systemLog('Plugin started successfully in worker');
						resolve();
						break;

					case 'apiCall':
						handleApiCall(msg.callId, msg.method, msg.args, plugin.installId)
							.then(result => {
								worker.postMessage({
									type: 'call',
									callId: msg.callId,
									result,
								});
							})
							.catch(error => {
								worker.postMessage({
									type: 'call',
									callId: msg.callId,
									error: String(error),
								});
							});
						break;
				}
			};

			worker.onerror = (error) => {
				console.error('Plugin worker error:', plugin.name, error);
				systemLog(`Worker error: ${error.message}`, true);
				reject(error);
			};

			const timeout = window.setTimeout(() => {
				systemLog('Plugin initialization timeout', true);
				reject(new Error('Plugin initialization timeout'));
			}, 30000);

			const originalResolve = resolve;
			resolve = (...args) => {
				window.clearTimeout(timeout);
				originalResolve(...args);
			};
		} catch (err) {
			console.error('Failed to launch plugin:', plugin.name, err);
			systemLog(`Failed to launch: ${err}`, true);
			reject(err);
		}
	});
}

export function abortPlugin(plugin: Plugin): void {
	const pluginContext = pluginContexts.get(plugin.installId);
	if (!pluginContext) return;

	pluginContext.worker.postMessage({ type: 'abort', pluginId: plugin.installId });
	pluginContext.worker.terminate();

	pluginContexts.delete(plugin.installId);
	pluginLogs.value.delete(plugin.installId);
	pluginHandlers = pluginHandlers.filter(x => x.pluginInstallId !== plugin.installId);
}

export function reloadPlugin(plugin: Plugin): void {
	abortPlugin(plugin);
	launchPlugin(plugin.installId);
}

export async function configPlugin(plugin: Plugin) {
	if (plugin.config == null) {
		throw new Error('This plugin does not have a config');
	}

	const config = plugin.config;
	for (const key in plugin.configData) {
		config[key].default = plugin.configData[key];
	}

	const { canceled, result } = await os.form(plugin.name, config);
	if (canceled) return;

	prefer.commit('plugins', prefer.s.plugins.map(x => x.installId === plugin.installId ? { ...x, configData: result } : x));

	reloadPlugin(plugin);
}

export function changePluginActive(plugin: Plugin, active: boolean) {
	prefer.commit('plugins', prefer.s.plugins.map(x => x.installId === plugin.installId ? { ...x, active } : x));

	if (active) {
		launchPlugin(plugin.installId);
	} else {
		abortPlugin(plugin);
	}
}

async function createPluginEnvForWorker(opts: { plugin: Plugin; storageKey: string; token?: string }): Promise<Record<string, any>> {
	const { createAiScriptEnv } = await import('@/aiscript/api.js');

	const baseEnv = createAiScriptEnv({ ...opts, token: opts.token });

	const serializableEnv: Record<string, any> = {};

	for (const [key, value] of Object.entries(baseEnv)) {
		if (typeof value === 'function') continue;

		if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
			serializableEnv[key] = value;
		}

		if (typeof value === 'object' && value !== null) {
			try {
				JSON.stringify(value);
				serializableEnv[key] = value;
			} catch {
				// Non-serializable, skip
			}
		}
	}

	const configData: Record<string, any> = {};
	for (const [k, v] of Object.entries(opts.plugin.config ?? {})) {
		configData[k] = typeof opts.plugin.configData[k] !== 'undefined' ? opts.plugin.configData[k] : v.default;
	}
	serializableEnv['Plugin:configData'] = configData;

	return serializableEnv;
}

async function handleApiCall(callId: string, method: string, args: any[], pluginId: string): Promise<any> {
	const { aiScriptReadline } = await import('@/aiscript/api.js');

	switch (method) {
		case 'Mk:dialog':
			await os.alert({
				type: args[2] || 'info',
				title: args[0],
				text: args[1],
			});
			return null;

		case 'Mk:confirm':
			const confirm = await os.confirm({
				type: args[2] || 'question',
				title: args[0],
				text: args[1],
			});
			return !confirm.canceled;

		case 'Mk:toast':
			os.toast(args[0]);
			return null;

		case 'Mk:api':
			{
				const ep = args[0];
				const param = args[1];
				const token = args[2];

				if (ep.includes('://') || ep.includes('..')) {
					throw new Error('invalid endpoint');
				}

				const plugin = prefer.s.plugins.find(x => x.installId === pluginId);
				const actualToken = token ?? store.s.pluginTokens[pluginId] ?? null;

				try {
					const res = await misskeyApi(ep as keyof Misskey.Endpoints, param as object, actualToken);
					return res;
				} catch (err) {
					return { error: 'request_failed', details: err };
				}
			}

		case 'Mk:save':
			{
				const key = args[0];
				const value = args[1];
				const storageKey = `aiscript:plugins:${pluginId}:${key}`;
				window.localStorage.setItem(storageKey, JSON.stringify(value));
				return null;
			}

		case 'Mk:load':
			{
				const key = args[0];
				const storageKey = `aiscript:plugins:${pluginId}:${key}`;
				const item = window.localStorage.getItem(storageKey);
				return item ? JSON.parse(item) : null;
			}

		case 'readline':
			return await aiScriptReadline(args[0]);

		case 'Plugin:open_url':
			window.open(args[0], '_blank', 'noopener');
			return null;

		case 'Plugin:register:post_form_action':
		case 'Plugin:register_post_form_action':
			{
				const title = args[0];
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('post_form_action', { type: 'post_form_action', data: { title } });
					addPluginHandler(pluginId, 'post_form_action', {
						title,
						handler: async (form, update) => {
							const result = await callWorkerHandler(pluginId, 'post_form_action', [form]);
							if (result && typeof result === 'object') {
								for (const [key, value] of Object.entries(result)) {
									update(key, value);
								}
							}
						},
					});
				}
				return null;
			}

		case 'Plugin:register:user_action':
		case 'Plugin:register_user_action':
			{
				const title = args[0];
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('user_action', { type: 'user_action', data: { title } });
					addPluginHandler(pluginId, 'user_action', {
						title,
						handler: async (user) => {
							await callWorkerHandler(pluginId, 'user_action', [user]);
						},
					});
				}
				return null;
			}

		case 'Plugin:register:note_action':
		case 'Plugin:register_note_action':
			{
				const title = args[0];
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('note_action', { type: 'note_action', data: { title } });
					addPluginHandler(pluginId, 'note_action', {
						title,
						handler: async (note) => {
							await callWorkerHandler(pluginId, 'note_action', [note]);
						},
					});
				}
				return null;
			}

		case 'Plugin:register:note_view_interruptor':
		case 'Plugin:register_note_view_interruptor':
			{
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('note_view_interruptor', { type: 'note_view_interruptor', data: {} });
					addPluginHandler(pluginId, 'note_view_interruptor', {
						handler: async (note) => {
							return await callWorkerHandler(pluginId, 'note_view_interruptor', [note]);
						},
					});
				}
				return null;
			}

		case 'Plugin:register:note_post_interruptor':
		case 'Plugin:register_note_post_interruptor':
			{
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('note_post_interruptor', { type: 'note_post_interruptor', data: {} });
					addPluginHandler(pluginId, 'note_post_interruptor', {
						handler: async (note) => {
							return await callWorkerHandler(pluginId, 'note_post_interruptor', [note]);
						},
					});
				}
				return null;
			}

		case 'Plugin:register:page_view_interruptor':
		case 'Plugin:register_page_view_interruptor':
			{
				const context = pluginContexts.get(pluginId);
				if (context) {
					context.handlers.set('page_view_interruptor', { type: 'page_view_interruptor', data: {} });
					addPluginHandler(pluginId, 'page_view_interruptor', {
						handler: async (page) => {
							return await callWorkerHandler(pluginId, 'page_view_interruptor', [page]);
						},
					});
				}
				return null;
			}

		default:
			throw new Error(`Unknown API method: ${method}`);
	}
}

async function callWorkerHandler(pluginId: string, handlerType: string, args: any[]): Promise<any> {
	const context = pluginContexts.get(pluginId);
	if (!context) throw new Error('Plugin context not found');

	return new Promise((resolve, reject) => {
		const callId = `handler-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

		const responseHandler = (event: MessageEvent) => {
			if (event.data.type === 'call' && event.data.callId === callId) {
				context.worker.removeEventListener('message', responseHandler);
				if (event.data.error) {
					reject(new Error(event.data.error));
				} else {
					resolve(event.data.result);
				}
			}
		};

		context.worker.addEventListener('message', responseHandler);

		context.worker.postMessage({
			type: 'invokeHandler',
			callId,
			handlerType,
			args,
		});

		window.setTimeout(() => {
			context.worker.removeEventListener('message', responseHandler);
			reject(new Error('Handler call timeout'));
		}, 10000);
	});
}

// Legacy function kept for compatibility (unused now, retained for reference)
// @ts-ignore - This function is no longer used but kept for documentation purposes
async function createPluginEnv(opts: { plugin: Plugin; storageKey: string }): Promise<Record<string, values.Value>> {
	const id = opts.plugin.installId;

	const ais = await import('@syuilo/aiscript');
	const values = ais.values;
	const utils: typeof utils_TypeReferenceOnly = ais.utils;
	const { createAiScriptEnv } = await import('@/aiscript/api.js');

	const config = new Map<string, values.Value>();
	for (const [k, v] of Object.entries(opts.plugin.config ?? {})) {
		config.set(k, utils.jsToVal(typeof opts.plugin.configData[k] !== 'undefined' ? opts.plugin.configData[k] : v.default));
	}

	function withContext<T>(_fn: (ctx: Interpreter) => T): T {
		throw new Error('Legacy createPluginEnv is not supported in Worker mode');
	}

	const env: Record<string, values.Value> = {
		...createAiScriptEnv({ ...opts, token: store.s.pluginTokens[id] }),

		'Plugin:register:post_form_action': values.FN_NATIVE(([title, handler]) => {
			utils.assertString(title);
			utils.assertFunction(handler);
			addPluginHandler(id, 'post_form_action', {
				title: title.value,
				handler: (form, update) => withContext(ctx => {
					ctx.execFn(handler, [utils.jsToVal(form), values.FN_NATIVE(([key, value]) => {
						if (!key || !value) {
							return;
						}
						update(utils.valToJs(key), utils.valToJs(value));
					})]);
				}),
			});
		}),

		'Plugin:register:user_action': values.FN_NATIVE(([title, handler]) => {
			utils.assertString(title);
			utils.assertFunction(handler);
			addPluginHandler(id, 'user_action', {
				title: title.value,
				handler: (user) => withContext(ctx => {
					ctx.execFn(handler, [utils.jsToVal(user)]);
				}),
			});
		}),

		'Plugin:register:note_action': values.FN_NATIVE(([title, handler]) => {
			utils.assertString(title);
			utils.assertFunction(handler);
			addPluginHandler(id, 'note_action', {
				title: title.value,
				handler: (note) => withContext(ctx => {
					ctx.execFn(handler, [utils.jsToVal(note)]);
				}),
			});
		}),

		'Plugin:register:note_view_interruptor': values.FN_NATIVE(([handler]) => {
			utils.assertFunction(handler);
			addPluginHandler(id, 'note_view_interruptor', {
				handler: (note) => withContext(ctx => {
					return utils.valToJs(ctx.execFnSync(handler, [utils.jsToVal(note)])) as Misskey.entities.Note | null;
				}),
			});
		}),

		'Plugin:register:note_post_interruptor': values.FN_NATIVE(([handler]) => {
			utils.assertFunction(handler);
			addPluginHandler(id, 'note_post_interruptor', {
				handler: (note) => withContext(ctx => {
					return utils.valToJs(ctx.execFnSync(handler, [utils.jsToVal(note)]));
				}),
			});
		}),

		'Plugin:register:page_view_interruptor': values.FN_NATIVE(([handler]) => {
			utils.assertFunction(handler);
			addPluginHandler(id, 'page_view_interruptor', {
				handler: (page) => withContext(ctx => {
					return utils.valToJs(ctx.execFnSync(handler, [utils.jsToVal(page)])) as Misskey.entities.Page;
				}),
			});
		}),

		'Plugin:open_url': values.FN_NATIVE(([url]) => {
			utils.assertString(url);
			window.open(url.value, '_blank', 'noopener');
		}),

		'Plugin:config': values.OBJ(config),
	};

	// 後方互換性のため
	env['Plugin:register_post_form_action'] = env['Plugin:register:post_form_action'];
	env['Plugin:register_user_action'] = env['Plugin:register:user_action'];
	env['Plugin:register_note_action'] = env['Plugin:register:note_action'];
	env['Plugin:register_note_view_interruptor'] = env['Plugin:register:note_view_interruptor'];
	env['Plugin:register_note_post_interruptor'] = env['Plugin:register:note_post_interruptor'];
	env['Plugin:register_page_view_interruptor'] = env['Plugin:register:page_view_interruptor'];

	return env;
}

export function getPluginHandlers<K extends keyof HandlerDef>(type: K): HandlerDef[K][] {
	return pluginHandlers.filter((x): x is PluginHandler<K> => x.type === type).map(x => x.ctx);
}
