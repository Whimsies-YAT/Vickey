import type {
	SecureFetch,
	SecureStorage,
	EnvironmentCheck,
	IntegrityCheck,
} from '../types.js';
import { SecurityAdapter } from '../adapter.js';

const webFetch: SecureFetch = async (url, options) => {
	const response = await fetch(url, {
		method: options?.method ?? 'GET',
		body: options?.body,
		credentials: options?.credentials,
		cache: options?.cache,
		headers: options?.headers,
	});

	return {
		status: response.status,
		json: () => response.json(),
	};
};

const webStorage: SecureStorage = {
	async set(key: string, value: string): Promise<void> {
		localStorage.setItem(`vickey:${key}`, value);
	},

	async get(key: string): Promise<string | null> {
		return localStorage.getItem(`vickey:${key}`);
	},

	async remove(key: string): Promise<void> {
		localStorage.removeItem(`vickey:${key}`);
	},

	async clear(): Promise<void> {
		const keys = Object.keys(localStorage).filter(k => k.startsWith('vickey:'));
		keys.forEach(k => localStorage.removeItem(k));
	},
};

const webEnvCheck: EnvironmentCheck = {
	async isRooted(): Promise<boolean> {
		return false;
	},
};

const webIntegrity: IntegrityCheck = {
	async verifySignature(): Promise<boolean> {
		return true;
	},

	async getCertificateFingerprint(): Promise<string> {
		return 'web-platform';
	},
};

export function createWebAdapter(): SecurityAdapter {
	return new SecurityAdapter(
		webFetch,
		webStorage,
		webEnvCheck,
		webIntegrity,
	);
}