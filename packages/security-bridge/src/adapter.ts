import type {
	SecureFetch,
	SecureStorage,
	EnvironmentCheck,
	IntegrityCheck,
	SecurityPolicy,
	SecurityCheckResult,
} from './types.js';

export class SecurityAdapter {
	constructor(
		public fetch: SecureFetch,
		public storage: SecureStorage,
		public env: EnvironmentCheck,
		public integrity: IntegrityCheck,
	) {}

	async checkSecurity(policy: SecurityPolicy): Promise<SecurityCheckResult> {
		const [rooted, signatureValid] = await Promise.all([
			this.env.isRooted().catch(() => false),
			this.integrity.verifySignature().catch(() => true),
		]);

		const threats: string[] = [];
		let isSecure = true;

		if (rooted) {
			threats.push('Device is rooted/jailbroken');
			if (policy.blockRooted && !policy.warnOnly) isSecure = false;
		}

		if (!signatureValid) {
			threats.push('App signature is invalid');
			isSecure = false;
		}

		return {
			isSecure,
			threats,
			details: {
				rooted,
				signatureValid,
			},
		};
	}

	static async create(): Promise<SecurityAdapter> {
		if (isNativePlatform()) {
			const { createNativeAdapter } = await import('./native/index.js');
			return createNativeAdapter();
		} else {
			const { createWebAdapter } = await import('./web/index.js');
			return createWebAdapter();
		}
	}
}

export function isNativePlatform(): boolean {
	if (typeof window === 'undefined') return false;
	return !!window.Capacitor?.isNativePlatform?.();
}

