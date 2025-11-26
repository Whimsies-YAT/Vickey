export type Base64URLString = string;

export type PublicKeyCredentialType = 'public-key';

export type AuthenticatorAttachment = 'cross-platform' | 'platform';

export type AuthenticatorTransportFuture = 'ble' | 'internal' | 'nfc' | 'usb' | 'cable' | 'hybrid' | 'smart-card';

export type CredentialDeviceType = 'singleDevice' | 'multiDevice';

export type COSEAlgorithmIdentifier = number;

export type AuthenticationExtensionsClientOutputsJSON = any;

export interface AuthenticatorAssertionResponseJSON {
	clientDataJSON: Base64URLString;
	authenticatorData: Base64URLString;
	signature: Base64URLString;
	userHandle?: Base64URLString;
}

export interface AuthenticationResponseJSON {
	id: Base64URLString;
	rawId: Base64URLString;
	response: AuthenticatorAssertionResponseJSON;
	authenticatorAttachment?: AuthenticatorAttachment;
	clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
	type: PublicKeyCredentialType;
}

export interface AuthenticatorAttestationResponseJSON {
	clientDataJSON: Base64URLString;
	attestationObject: Base64URLString;
	authenticatorData?: Base64URLString;
	transports?: AuthenticatorTransportFuture[];
	publicKeyAlgorithm?: COSEAlgorithmIdentifier;
	publicKey?: Base64URLString;
}

export interface RegistrationResponseJSON {
	id: Base64URLString;
	rawId: Base64URLString;
	response: AuthenticatorAttestationResponseJSON;
	authenticatorAttachment?: AuthenticatorAttachment;
	clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
	type: PublicKeyCredentialType;
}

export interface PublicKeyCredentialCreationOptionsJSON {
	rp: {
		name: string;
		id?: string;
	};
	user: {
		id: string;
		name: string;
		displayName: string;
	};
	challenge: Base64URLString;
	pubKeyCredParams: {
		type: PublicKeyCredentialType;
		alg: COSEAlgorithmIdentifier;
	}[];
	timeout?: number;
	excludeCredentials?: {
		id: Base64URLString;
		type: PublicKeyCredentialType;
		transports?: AuthenticatorTransportFuture[];
	}[];
	authenticatorSelection?: {
		authenticatorAttachment?: AuthenticatorAttachment;
		requireResidentKey?: boolean;
		residentKey?: 'discouraged' | 'preferred' | 'required';
		userVerification?: 'discouraged' | 'preferred' | 'required';
	};
	attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
	extensions?: AuthenticationExtensionsClientOutputsJSON;
}

export interface PublicKeyCredentialRequestOptionsJSON {
	challenge: Base64URLString;
	timeout?: number;
	rpId?: string;
	allowCredentials?: {
		id: Base64URLString;
		type: PublicKeyCredentialType;
		transports?: AuthenticatorTransportFuture[];
	}[];
	userVerification?: 'discouraged' | 'preferred' | 'required';
	extensions?: AuthenticationExtensionsClientOutputsJSON;
}
