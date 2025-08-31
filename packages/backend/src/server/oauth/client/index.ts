/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export { OAuthClientService } from './OAuthClientService.js';
export { OIDCClientService } from './OIDCClientService.js';
export { SSOService } from './SSOService.js';
export { JWTService } from './JWTService.js';
export { OAuthClientConfigService } from './OAuthClientConfigService.js';
export { SessionService } from './SessionService.js';

export type {
	OAuthClientConfig,
	AuthorizationRequest,
	TokenResponse,
	UserInfo,
} from './OAuthClientService.js';

export type {
	OIDCConfiguration,
	JWKSet,
	JWK,
	IDTokenClaims,
} from './OIDCClientService.js';

export type {
	SSOProvider,
	SSOSession,
	SSOLoginResult,
} from './SSOService.js';

export type {
	JWTHeader,
	JWTPayload,
	DecodedJWT,
} from './JWTService.js';

export type {
	CreateOAuthClientConfigRequest,
	UpdateOAuthClientConfigRequest,
} from './OAuthClientConfigService.js';

export type {
	SessionInfo,
	CreateSessionRequest,
} from './SessionService.js';
