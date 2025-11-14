/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - Worker module resolution handled by Vite at build time
import { Parser, Interpreter, values, utils } from '@syuilo/aiscript';

type WorkerMessage =
	| { type: 'init'; pluginId: string; code: string; env: Record<string, any> }
	| { type: 'abort'; pluginId: string }
	| { type: 'call'; callId: string; result: any; error?: string };

type MainThreadMessage =
	| { type: 'output'; pluginId: string; value: string }
	| { type: 'log'; pluginId: string; message: string }
	| { type: 'error'; pluginId: string; error: string }
	| { type: 'complete'; pluginId: string }
	| { type: 'systemLog'; pluginId: string; message: string; isError?: boolean }
	| { type: 'registerHandler'; pluginId: string; handlerType: string; title?: string }
	| { type: 'apiCall'; pluginId: string; callId: string; method: string; args: any[] };

const interpreters = new Map<string, Interpreter>();
let parser: Parser | null = null;

function getParser(): Parser {
	if (!parser) {
		parser = new Parser();
	}
	return parser;
}

const pendingCalls = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();

function generateCallId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function callMainThread(pluginId: string, method: string, args: any[]): Promise<any> {
	return new Promise((resolve, reject) => {
		const callId = generateCallId();
		pendingCalls.set(callId, { resolve, reject });

		self.postMessage({
			type: 'apiCall',
			pluginId,
			callId,
			method,
			args,
		} satisfies MainThreadMessage);

		setTimeout(() => {
			if (pendingCalls.has(callId)) {
				pendingCalls.delete(callId);
				reject(new Error('API call timeout'));
			}
		}, 30000);
	});
}

function createWorkerEnv(pluginId: string, baseEnv: Record<string, any>): Record<string, values.Value> {
	const env: Record<string, values.Value> = {};

	for (const [key, value] of Object.entries(baseEnv)) {
		if (typeof value !== 'function') {
			env[key] = value;
		}
	}

	const apiKeys = [
		'Mk:dialog',
		'Mk:confirm',
		'Mk:toast',
		'Mk:api',
		'Mk:save',
		'Mk:load',
		'Plugin:register:post_form_action',
		'Plugin:register:user_action',
		'Plugin:register:note_action',
		'Plugin:register:note_view_interruptor',
		'Plugin:register:note_post_interruptor',
		'Plugin:register:page_view_interruptor',
		'Plugin:open_url',
		'Plugin:register_post_form_action',
		'Plugin:register_user_action',
		'Plugin:register_note_action',
		'Plugin:register_note_view_interruptor',
		'Plugin:register_note_post_interruptor',
		'Plugin:register_page_view_interruptor',
	];

	for (const key of apiKeys) {
		env[key] = values.FN_NATIVE(async (args: values.Value[]) => {
			try {
				const result = await callMainThread(pluginId, key, args.map((arg: values.Value) => utils.valToJs(arg)));
				return utils.jsToVal(result);
			} catch (err) {
				return values.ERROR('api_call_failed', utils.jsToVal(err));
			}
		});
	}

	return env;
}

async function initPlugin(pluginId: string, code: string, baseEnv: Record<string, any>): Promise<void> {
	try {
		self.postMessage({
			type: 'systemLog',
			pluginId,
			message: 'Initializing plugin in worker...',
		} satisfies MainThreadMessage);

		const env = createWorkerEnv(pluginId, baseEnv);

		const interpreter = new Interpreter(env, {
			in: (q: string) => callMainThread(pluginId, 'readline', [q]),
			out: (value: values.Value): void => {
				self.postMessage({
					type: 'output',
					pluginId,
					value: utils.reprValue(value),
				} satisfies MainThreadMessage);
			},
			log: (): void => {
			},
			err: (err: unknown): void => {
				self.postMessage({
					type: 'error',
					pluginId,
					error: String(err),
				} satisfies MainThreadMessage);
			},
		});

		interpreters.set(pluginId, interpreter);

		const parserInstance = getParser();
		const ast = parserInstance.parse(code);

		self.postMessage({
			type: 'systemLog',
			pluginId,
			message: 'Executing plugin code...',
		} satisfies MainThreadMessage);

		await interpreter.exec(ast);

		self.postMessage({
			type: 'complete',
			pluginId,
		} satisfies MainThreadMessage);

		self.postMessage({
			type: 'systemLog',
			pluginId,
			message: 'Plugin started successfully',
		} satisfies MainThreadMessage);
	} catch (err) {
		self.postMessage({
			type: 'error',
			pluginId,
			error: String(err),
		} satisfies MainThreadMessage);

		self.postMessage({
			type: 'systemLog',
			pluginId,
			message: `Plugin failed: ${err}`,
			isError: true,
		} satisfies MainThreadMessage);
	}
}

function abortPlugin(pluginId: string): void {
	const interpreter = interpreters.get(pluginId);
	if (interpreter) {
		interpreter.abort();
		interpreters.delete(pluginId);
	}
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
	const msg = event.data;

	switch (msg.type) {
		case 'init':
			await initPlugin(msg.pluginId, msg.code, msg.env);
			break;

		case 'abort':
			abortPlugin(msg.pluginId);
			break;

		case 'call':
			const pending = pendingCalls.get(msg.callId);
			if (pending) {
				pendingCalls.delete(msg.callId);
				if (msg.error) {
					pending.reject(new Error(msg.error));
				} else {
					pending.resolve(msg.result);
				}
			}
			break;
	}
});

self.postMessage({ type: 'ready' });
