/**
 * Platform-agnostic security layer for Vickey mobile apps
 * Web: Standard browser APIs / Native: Capacitor plugins with SSL Pinning & Keystore
 */

export { SecurityAdapter, isNativePlatform } from './adapter.js';
export { ServerConfig, CONFIG_KEYS } from './config.js';
export type {
	SecureFetch,
	SecureStorage,
	EnvironmentCheck,
	IntegrityCheck,
	SecurityPolicy,
	SecurityCheckResult,
} from './types.js';