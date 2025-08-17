/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { secureRndstr } from '@/misc/secure-rndstr.js';
import { randomBytes, createHmac } from 'node:crypto';
import { loadConfig } from '@/config.js'

const TIMESTAMP_SALT = Buffer.from(loadConfig().tokenSalt, 'utf-8');
const HMAC_KEY = Buffer.from(loadConfig().tokenSalt, 'utf-8');

/* @deprecated
 * DO NOT USE IT ANYMORE!
 */
export const generateNativeUserToken = () => secureRndstr(16);

export const generateDeviceId = (source: string = 'U') => {
	const validSources = ['M', 'P', 'C', 'U'];
	const normalizedSource = (source.length === 1 && validSources.includes(source)) ? source : 'U';
	const ts = Date.now().toString(36);
	const rand = secureRndstr(8);
	return `${normalizedSource}-${ts}-${rand}`;
};

export const generateNewToken = (version?: number) => {
	const ver = (version && version >= 1 && version <= 15) ? version : 1;

	const versionAndFlags = Buffer.from([(ver << 4) & 0xF0]);

	const timestamp = Buffer.allocUnsafe(6);
	const now = Date.now();
	timestamp.writeUIntBE(now, 0, 6);
	for (let i = 0; i < 6; i++) {
		timestamp[i] ^= TIMESTAMP_SALT[i];
	}

	const processId = Buffer.allocUnsafe(2);
	processId.writeUInt16BE(process.pid & 0xFFFF, 0);

	let counter = generateNewToken.counter || 0;
	generateNewToken.counter = (counter + 1) & 0xFFFF;
	const sequence = Buffer.allocUnsafe(2);
	sequence.writeUInt16BE(generateNewToken.counter, 0);

	const randomData = randomBytes(13);

	const tokenWithoutSig = Buffer.concat([versionAndFlags, timestamp, processId, sequence, randomData]);
	const hmac = createHmac('sha512', HMAC_KEY);
	hmac.update(tokenWithoutSig);
	const signature = hmac.digest().subarray(0, 16);
	const fullToken = Buffer.concat([tokenWithoutSig, signature]);
	return fullToken.toString('base64url');
};
generateNewToken.counter = Math.floor(Math.random() * 65536);

export const isNativeUserToken = (token: string) => token.length === 16;

export const isNewToken = (token: string, isApi: boolean = false) => {
	if (!/^[A-Za-z0-9_-]{54}$/.test(token)) return { valid: false, needRefresh: false };

	try {
		const data = Buffer.from(token, 'base64url');
		if (data.length !== 40) return { valid: false, needRefresh: false };;

		const versionAndFlags = data[0];
		const version = (versionAndFlags & 0xF0) >> 4;
		if (version < 1 || version > 15) return { valid: false, needRefresh: false };;

		const tokenWithoutSig = data.subarray(0, 24);
		const providedSignature = data.subarray(24, 40);

		const hmac = createHmac('sha512', HMAC_KEY);
		hmac.update(tokenWithoutSig);
		const expectedSignature = hmac.digest().subarray(0, 16);

		if (!providedSignature.equals(expectedSignature)) return { valid: false, needRefresh: false };;

		const obfTimestamp = data.subarray(1, 7);
		for (let i = 0; i < 6; i++) {
			obfTimestamp[i] ^= TIMESTAMP_SALT[i];
		}
		const timestamp = obfTimestamp.readUIntBE(0, 6);

		const now = Date.now();
		const fiveMinutesLater = now + (5 * 1000);

		let valid: boolean;
		if (isApi) {
			valid = timestamp <= fiveMinutesLater;
		} else {
			const oneYearAgo = now - (365 * 24 * 3600 * 1000);
			valid = timestamp >= oneYearAgo && timestamp <= fiveMinutesLater;
		}

		const oneMonthBeforeExpiry = now - (335 * 24 * 3600 * 1000);
		const needRefresh = valid && !isApi && timestamp <= oneMonthBeforeExpiry;

		return { valid, needRefresh };
	} catch {
		return { valid: false, needRefresh: false };;
	}
};
