import type { SecureStorage } from './types.js';

export const CONFIG_KEYS = {
	SERVER_URL: 'server_url',
	ACCESS_TOKEN: 'access_token',
	LAST_LOGIN_USER: 'last_login_user',
} as const;

export class ServerConfig {
	constructor(private storage: SecureStorage) {}

	async hasServer(): Promise<boolean> {
		const url = await this.storage.get(CONFIG_KEYS.SERVER_URL);
		return url !== null && url.length > 0;
	}

	async getServerUrl(): Promise<string | null> {
		return await this.storage.get(CONFIG_KEYS.SERVER_URL);
	}

	async setServerUrl(url: string): Promise<void> {
		const normalized = url.replace(/\/$/, '');

		if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
			throw new Error('Server URL must start with http:// or https://');
		}

		await this.storage.set(CONFIG_KEYS.SERVER_URL, normalized);
	}

	async clearServer(): Promise<void> {
		await this.storage.remove(CONFIG_KEYS.SERVER_URL);
		await this.storage.remove(CONFIG_KEYS.ACCESS_TOKEN);
		await this.storage.remove(CONFIG_KEYS.LAST_LOGIN_USER);
	}

	async verifyServer(url: string): Promise<{ valid: boolean; error?: string; meta?: any }> {
		try {
			const normalized = url.replace(/\/$/, '');
			const response = await fetch(`${normalized}/api/meta`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ detail: false }),
			});

			if (!response.ok) {
				return { valid: false, error: `Server responded with ${response.status}` };
			}

			const meta = await response.json();

			if (!meta.version) {
				return { valid: false, error: 'Not a valid Misskey instance' };
			}

			return { valid: true, meta };
		} catch (error) {
			return {
				valid: false,
				error: error instanceof Error ? error.message : 'Connection failed'
			};
		}
	}
}