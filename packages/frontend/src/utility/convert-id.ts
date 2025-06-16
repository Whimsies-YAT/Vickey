/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { customAlphabet } from 'nanoid';
import { ulid as genUlidWithTimestamp, decodeTime } from 'ulid';

declare const crypto: Crypto;

function parseBigIntChunked(
	str: string,
	base: number,
	chunkSize: number,
	powerOfChunkSize: bigint
): bigint {
	const chunks: string[] = [];
	while (str.length > 0) {
		chunks.unshift(str.slice(-chunkSize));
		str = str.slice(0, -chunkSize);
	}
	let result = 0n;
	for (const chunk of chunks) {
		result *= powerOfChunkSize;
		const intVal = parseInt(chunk, base);
		if (Number.isNaN(intVal)) {
			throw new Error(`Invalid string for base ${base}: ${chunk}`);
		}
		result += BigInt(intVal);
	}
	return result;
}

const AID_TIME2000 = 946684800000;
const aidRegexp = /^[0-9a-z]{10}$/;
const bytes = crypto.getRandomValues(new Uint8Array(2));
let aidCounter = new DataView(bytes.buffer).getUint16(0, true);

function genAid(t: number): string {
	const delta = Math.max(0, t - AID_TIME2000).toString(36).padStart(8, '0');
	aidCounter++;
	return delta + aidCounter.toString(36).padStart(2, '0').slice(-2);
}

function parseAid(id: string): number {
	return parseInt(id.slice(0, 8), 36) + AID_TIME2000;
}

const AIDX_TIME2000 = 946684800000;
const aidxRegexp = /^[0-9a-z]{16}$/;
const aidxNodeId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 4)();
let aidxCounter = 0;

function genAidx(t: number): string {
	const delta = Math.max(0, t - AIDX_TIME2000).toString(36).padStart(8, '0');
	aidxCounter++;
	return delta + aidxNodeId + aidxCounter.toString(36).padStart(4, '0').slice(-4);
}

function parseAidx(id: string): number {
	return parseInt(id.slice(0, 8), 36) + AIDX_TIME2000;
}

const MEID_OFFSET = 0x800000000000;
const meidRegexp = /^[0-9a-f]{24}$/;

function genMeid(t: number): string {
	const timeHex = (Math.max(0, t) + MEID_OFFSET).toString(16).padStart(12, '0');
	return timeHex + Array.from(crypto.getRandomValues(new Uint8Array(6)))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function parseMeid(id: string): number {
	return parseInt(id.slice(0, 12), 16) - MEID_OFFSET;
}

const MEIDG_REGEXP = /^g[0-9a-f]{23}$/;

function genMeidg(t: number): string {
	const timeHex = Math.max(0, t).toString(16).padStart(11, '0');
	return 'g' + timeHex + Array.from(crypto.getRandomValues(new Uint8Array(6)))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function parseMeidg(id: string): number {
	return parseInt(id.slice(1, 12), 16);
}

const OBJECTID_REGEXP = /^[0-9a-f]{24}$/;

function genObjectId(t: number): string {
	const secsHex = Math.floor(Math.max(0, t) / 1000).toString(16).padStart(8, '0');
	return secsHex + Array.from(crypto.getRandomValues(new Uint8Array(12)))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function parseObjectId(id: string): number {
	return parseInt(id.slice(0, 8), 16) * 1000;
}

const ULID_REGEXP = /^[0-9A-Z]{26}$/;

function parseUlid(id: string): number {
	return decodeTime(id);
}

export type IdType =
	| 'aid'
	| 'aidx'
	| 'meid'
	| 'meidg'
	| 'objectId'
	| 'ulid'
	| 'timestamp';

export function transform(
	from: string,
	to: string,
	value: string
): string {
	let timestamp: number;
	const id = String(value);
	if (from === 'timestamp') {
		timestamp = parseInt(value as string, 10);
	} else {
		if (from === 'aid' && aidRegexp.test(id)) timestamp = parseAid(id);
		else if (from === 'aidx' && aidxRegexp.test(id)) timestamp = parseAidx(id);
		else if (from === 'meid' && meidRegexp.test(id)) timestamp = parseMeid(id);
		else if (from === 'meidg' && MEIDG_REGEXP.test(id)) timestamp = parseMeidg(id);
		else if (from === 'objectId' && OBJECTID_REGEXP.test(id)) timestamp = parseObjectId(id);
		else if (from === 'ulid' && ULID_REGEXP.test(id)) timestamp = parseUlid(id);
		else timestamp = -1;
	}

	if (to === 'timestamp') {
		if (timestamp === -1) { return `Invalid value for type ${from}: ${id}`; }
		return String(timestamp);
	}

	switch (to) {
		case 'aid':
			return genAid(timestamp);
		case 'aidx':
			return genAidx(timestamp);
		case 'meid':
			return genMeid(timestamp);
		case 'meidg':
			return genMeidg(timestamp);
		case 'objectId':
			return genObjectId(timestamp);
		case 'ulid':
			return genUlidWithTimestamp(timestamp);
		default:
			return `Unsupported target type: ${to}`;
	}
}
