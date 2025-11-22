export interface SecureFetch {
	(url: string, options?: {
		method?: string;
		body?: Blob | FormData | string;
		credentials?: RequestCredentials;
		cache?: RequestCache;
		headers?: Record<string, string>;
	}): Promise<{
		status: number;
		json(): Promise<any>;
	}>;
}

export interface SecureStorage {
	set(key: string, value: string): Promise<void>;
	get(key: string): Promise<string | null>;
	remove(key: string): Promise<void>;
	clear(): Promise<void>;
}

export interface EnvironmentCheck {
	isRooted(): Promise<boolean>;
}

export interface IntegrityCheck {
	verifySignature(): Promise<boolean>;
	getCertificateFingerprint(): Promise<string>;
}

export interface SecurityPolicy {
	blockRooted: boolean;
	warnOnly: boolean;
}

export interface SecurityCheckResult {
	isSecure: boolean;
	threats: string[];
	details: {
		rooted?: boolean;
		signatureValid?: boolean;
	};
}