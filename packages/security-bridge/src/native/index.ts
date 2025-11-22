import { registerPlugin } from '@capacitor/core';
import type {
	SecureFetch,
	SecureStorage,
	EnvironmentCheck,
	IntegrityCheck,
} from '../types.js';
import { SecurityAdapter } from '../adapter.js';

interface SecureHttpPlugin {
	fetch(options: {
		url: string;
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	}): Promise<{
		status: number;
		body: string;
	}>;
}

interface SecureStoragePlugin {
	set(options: { key: string; value: string }): Promise<void>;
	get(options: { key: string }): Promise<{ value: string | null }>;
	remove(options: { key: string }): Promise<void>;
	clear(): Promise<void>;
}

interface EnvCheckPlugin {
	isRooted(): Promise<{ value: boolean }>;
}

interface IntegrityCheckPlugin {
	verifySignature(): Promise<{ valid: boolean }>;
	getCertificateFingerprint(): Promise<{ fingerprint: string }>;
}

const SecureHttp = registerPlugin<SecureHttpPlugin>('SecureHttp');
const SecureStoragePlugin = registerPlugin<SecureStoragePlugin>('SecureStorage');
const EnvCheckPlugin = registerPlugin<EnvCheckPlugin>('EnvCheck');
const IntegrityCheckPlugin = registerPlugin<IntegrityCheckPlugin>('IntegrityCheck');

const nativeFetch: SecureFetch = async (url, options) => {
	let body: string | undefined;
	if (options?.body) {
		if (typeof options.body === 'string') {
			body = options.body;
		} else if (options.body instanceof FormData) {
			body = JSON.stringify(Object.fromEntries(options.body));
		}
	}

	const response = await SecureHttp.fetch({
		url,
		method: options?.method ?? 'GET',
		headers: options?.headers,
		body,
	});

	return {
		status: response.status,
		json: async () => JSON.parse(response.body),
	};
};

const nativeStorage: SecureStorage = {
	async set(key: string, value: string): Promise<void> {
		await SecureStoragePlugin.set({ key, value });
	},

	async get(key: string): Promise<string | null> {
		const result = await SecureStoragePlugin.get({ key });
		return result.value;
	},

	async remove(key: string): Promise<void> {
		await SecureStoragePlugin.remove({ key });
	},

	async clear(): Promise<void> {
		await SecureStoragePlugin.clear();
	},
};

const nativeEnvCheck: EnvironmentCheck = {
	async isRooted(): Promise<boolean> {
		const result = await EnvCheckPlugin.isRooted();
		return result.value;
	},
};

const nativeIntegrity: IntegrityCheck = {
	async verifySignature(): Promise<boolean> {
		const result = await IntegrityCheckPlugin.verifySignature();
		return result.valid;
	},

	async getCertificateFingerprint(): Promise<string> {
		const result = await IntegrityCheckPlugin.getCertificateFingerprint();
		return result.fingerprint;
	},
};

export function createNativeAdapter(): SecurityAdapter {
	return new SecurityAdapter(
		nativeFetch,
		nativeStorage,
		nativeEnvCheck,
		nativeIntegrity,
	);
}