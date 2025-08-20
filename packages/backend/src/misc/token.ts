/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { secureRndstr } from '@/misc/secure-rndstr.js';
import { randomBytes, createHmac } from 'node:crypto';
import { loadConfig } from '@/config.js';
import { timingSafeEqual } from 'node:crypto';

const config = loadConfig();
const TIMESTAMP_SALT = Buffer.from(config.tokenSalt, 'utf-8');
const HMAC_KEY = Buffer.from(config.hmacKey, 'utf-8');

let MACHINE_FINGERPRINT = randomBytes(4).readUInt32BE(0);
let WORKER_ID = randomBytes(2).readUInt16BE(0) & 0x3FF;

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

function masksFromEncryptedTimestamp(encTs: Buffer) {
	const tsMask32 = (encTs.readUInt32BE(0) ^ encTs.readUInt32BE(4)) >>> 0;
	const tsMask10 = (encTs.readUInt16BE(2) ^ encTs.readUInt16BE(6)) & 0x3FF;
	return { tsMask32, tsMask10 };
}

export const generateNewToken = (version?: number, opts?: { machine?: number; worker?: number }) => {
	const ver = (version && version >= 1 && version <= 15) ? version : 1;

	const versionAndFlags = Buffer.from([(ver << 4) & 0xF0]);

	const timestamp = Date.now();
	const timestampBuffer = Buffer.allocUnsafe(8);
	timestampBuffer.writeBigUInt64BE(BigInt(timestamp), 0);

	const encryptedTimestamp = Buffer.alloc(8);
	const keyDerivation = createHmac('sha256', TIMESTAMP_SALT);
	keyDerivation.update(Buffer.from([ver]));
	keyDerivation.update(Buffer.from('timestamp_encryption'));
	const fullKeyStream = keyDerivation.digest();
	for (let i = 0; i < 8; i++) {
		encryptedTimestamp[i] = timestampBuffer[i] ^ fullKeyStream[i];
	}

	const machineIdRaw = (opts?.machine ?? MACHINE_FINGERPRINT) >>> 0;
	const workerIdRaw = (opts?.worker ?? WORKER_ID) & 0x3FF;

	const { tsMask32, tsMask10 } = masksFromEncryptedTimestamp(encryptedTimestamp);
	const machineIdObf = (machineIdRaw ^ tsMask32) >>> 0;
	const workerIdObf = (workerIdRaw ^ tsMask10) & 0x3FF;

	const machineId = Buffer.allocUnsafe(4);
	machineId.writeUInt32BE(machineIdObf, 0);

	const workerId = Buffer.allocUnsafe(2);
	workerId.writeUInt16BE(workerIdObf, 0);

	const counter = generateNewToken.counter || 0;
	generateNewToken.counter = (counter + 1) & 0xFFFF;
	const sequence = Buffer.allocUnsafe(2);
	sequence.writeUInt16BE(generateNewToken.counter, 0);

	const randomData = randomBytes(12);

	const tokenWithoutSig = Buffer.concat([versionAndFlags, encryptedTimestamp, machineId, workerId, sequence, randomData]);

	const hmac = createHmac('sha512', HMAC_KEY);
	hmac.update(tokenWithoutSig);
	const signature = hmac.digest().subarray(0, 16);

	const fullToken = Buffer.concat([tokenWithoutSig, signature]);
	return fullToken.toString('base64url');
};
generateNewToken.counter = Math.floor(Math.random() * 65536);

export const isNativeUserToken = (token: string) => token.length === 16;

export const isNewToken = (token: string, isApi: boolean = false) => {
	if (!/^[A-Za-z0-9_-]{60}$/.test(token)) return { valid: false, needRefresh: false };

	try {
		const data = Buffer.from(token, 'base64url');
		if (data.length !== 45) return { valid: false, needRefresh: false };

		const versionAndFlags = data[0];
		const version = (versionAndFlags & 0xF0) >> 4;
		if (version < 1 || version > 15) return { valid: false, needRefresh: false };

		const tokenWithoutSig = data.subarray(0, 29);
		const providedSignature = data.subarray(29, 45);

		const hmac = createHmac('sha512', HMAC_KEY);
		hmac.update(tokenWithoutSig);
		const expectedSignature = hmac.digest().subarray(0, 16);

		if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(providedSignature, expectedSignature)) return { valid: false, needRefresh: false };

		const encryptedTimestamp = data.subarray(1, 9);
		const decryptedTimestamp = Buffer.alloc(8);

		const keyDerivation = createHmac('sha256', TIMESTAMP_SALT);
		keyDerivation.update(Buffer.from([version]));
		keyDerivation.update(Buffer.from('timestamp_encryption'));
		const fullKeyStream = keyDerivation.digest();

		for (let i = 0; i < 8; i++) {
			decryptedTimestamp[i] = encryptedTimestamp[i] ^ fullKeyStream[i];
		}

		const timestamp = Number(decryptedTimestamp.readBigUInt64BE(0));

		const now = Date.now();
		const fiveMinutesLater = now + (5 * 60 * 1000);

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
		return { valid: false, needRefresh: false };
	}
};

export const generateSessionToken = (sessionId: string, version?: number) => {
	const sessionHmac = createHmac('sha256', HMAC_KEY).update(Buffer.from(sessionId, 'utf-8')).digest();
	const machine = sessionHmac.readUInt32BE(0) >>> 0;
	const worker = sessionHmac.readUInt16BE(4) & 0x3FF;
	return generateNewToken(version, { machine, worker });
};

export const verifySessionToken = (token: string, sessionId: string, isApi: boolean = false) => {
	const result = isNewToken(token, isApi);
	if (!result.valid) return { ...result, sessionMatches: false };

	try {
		const data = Buffer.from(token, 'base64url');
		const encryptedTimestamp = data.subarray(1, 9);
		const { tsMask32, tsMask10 } = masksFromEncryptedTimestamp(encryptedTimestamp);

		const tokenMachineIdObf = data.readUInt32BE(9);
		const tokenWorkerIdObf = data.readUInt16BE(13) & 0x3FF;

		const tokenMachineId = (tokenMachineIdObf ^ tsMask32) >>> 0;
		const tokenWorkerId = (tokenWorkerIdObf ^ tsMask10) & 0x3FF;

		const sessionHmac = createHmac('sha256', HMAC_KEY);
		sessionHmac.update(Buffer.from(sessionId, 'utf-8'));
		const sessionHash = sessionHmac.digest();

		const expectedMachineId = sessionHash.readUInt32BE(0) >>> 0;
		const expectedWorkerId = (sessionHash.readUInt16BE(4) & 0x3FF);

		const sessionMatches = (tokenMachineId === expectedMachineId) &&
			(tokenWorkerId === expectedWorkerId);

		return { ...result, sessionMatches };
	} catch {
		return { ...result, sessionMatches: false };
	}
};

export const rotateMachineFingerprint = () => {
	MACHINE_FINGERPRINT = randomBytes(4).readUInt32BE(0);
	WORKER_ID = randomBytes(2).readUInt16BE(0) & 0x3FF;
	return { machineId: MACHINE_FINGERPRINT, workerId: WORKER_ID };
};

export const extractTokenInfo = (token: string) => {
	try {
		const data = Buffer.from(token, 'base64url');
		if (data.length !== 45) return null;

		const encryptedTimestamp = data.subarray(1, 9);
		const { tsMask32, tsMask10 } = masksFromEncryptedTimestamp(encryptedTimestamp);

		const machineIdObf = data.readUInt32BE(9);
		const workerIdObf = data.readUInt16BE(13) & 0x3FF;

		const machineId = (machineIdObf ^ tsMask32) >>> 0;
		const workerId = (workerIdObf ^ tsMask10) & 0x3FF;

		return {
			version: (data[0] & 0xF0) >> 4,
			encryptedTimestamp: encryptedTimestamp.toString('hex'),
			machineId,
			workerId,
			machineIdObf,
			workerIdObf,
			sequence: data.readUInt16BE(15),
			randomData: data.subarray(17, 24).toString('hex'),
			signature: data.subarray(24).toString('hex')
		};
	} catch {
		return null;
	}
};
