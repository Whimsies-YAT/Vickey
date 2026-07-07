/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { promisify } from 'node:util';
import * as slaccModule from 'slacc';

export type AhoCorasick = {
	isMatch(input: string): boolean;
};

type AhoCorasickConstructor = {
	withPatterns(patterns: string[]): AhoCorasick;
};

type RsaKeyPair = {
	sign(data: Buffer, callback: (err: Error | null, result: Buffer) => void): void;
};

type RsaKeyPairConstructor = {
	prototype: RsaKeyPair;
	fromPem(pem: string): RsaKeyPair;
};

type ZipReader = {
	viaBuffer(buffer: Buffer): void;
};

type ZipReaderConstructor = {
	withDestinationPath(path: string): ZipReader;
};

type RuntimeSlaccExports = {
	default?: RuntimeSlaccExports;
	'module.exports'?: RuntimeSlaccExports;
	AhoCorasick?: AhoCorasickConstructor;
	JsAhoCorasick?: AhoCorasickConstructor;
	RsaKeyPair?: RsaKeyPairConstructor;
	JsRsaKeyPair?: RsaKeyPairConstructor;
	ZipReader?: ZipReaderConstructor;
	JsZipReader?: ZipReaderConstructor;
	init?: (numThreads: number) => void;
};

const slacc = slaccModule as RuntimeSlaccExports;
const slaccRoots = [slacc, slacc.default, slacc['module.exports']].filter((root, index, roots): root is RuntimeSlaccExports => {
	return root != null && roots.indexOf(root) === index;
});

function getRuntimeExport<T>(names: string[], isValid: (value: unknown) => value is T): T {
	for (const root of slaccRoots) {
		for (const name of names) {
			const value = root[name as keyof RuntimeSlaccExports];
			if (isValid(value)) return value;
		}
	}

	throw new Error(`slacc is loaded but does not expose a usable ${names.join('/')} export for this platform.`);
}

export const AhoCorasick = getRuntimeExport<AhoCorasickConstructor>(['AhoCorasick', 'JsAhoCorasick'], (value): value is AhoCorasickConstructor => {
	const constructor = value as Partial<AhoCorasickConstructor> | undefined;
	return typeof value === 'function' && typeof constructor?.withPatterns === 'function';
});

export const RsaKeyPair = getRuntimeExport<RsaKeyPairConstructor>(['RsaKeyPair', 'JsRsaKeyPair'], (value): value is RsaKeyPairConstructor => {
	const constructor = value as Partial<RsaKeyPairConstructor> | undefined;
	return typeof value === 'function' && typeof constructor?.fromPem === 'function' && typeof constructor.prototype?.sign === 'function';
});

export const ZipReader = getRuntimeExport<ZipReaderConstructor>(['ZipReader', 'JsZipReader'], (value): value is ZipReaderConstructor => {
	const constructor = value as Partial<ZipReaderConstructor> | undefined;
	return typeof value === 'function' && typeof constructor?.withDestinationPath === 'function';
});

export const init = getRuntimeExport<(numThreads: number) => void>(['init'], (value): value is (numThreads: number) => void => {
	return typeof value === 'function';
});

export async function signRsaSha256(privateKeyPem: string, data: Buffer): Promise<Buffer> {
	const keyPair = RsaKeyPair.fromPem(privateKeyPem);
	const sign = promisify(keyPair.sign).bind(keyPair) as (data: Buffer) => Promise<Buffer>;
	return sign(data);
}
