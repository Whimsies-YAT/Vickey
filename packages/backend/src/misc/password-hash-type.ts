/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function isArgon2Hash(hash: string): boolean {
	return hash.length > 9 && hash.charCodeAt(0) === 36 && // '$'
		hash.charCodeAt(1) === 97 && // 'a'
		hash.charCodeAt(2) === 114 && // 'r'
		hash.charCodeAt(3) === 103 && // 'g'
		hash.charCodeAt(4) === 111 && // 'o'
		hash.charCodeAt(5) === 110 && // 'n'
		hash.charCodeAt(6) === 50 && // '2'
		hash.charCodeAt(7) === 105 && // 'i'
		hash.charCodeAt(8) === 100 && // 'd'
		hash.charCodeAt(9) === 36; // '$'
}

export function isBcryptHash(hash: string): boolean {
	if (hash.length < 4) return false;

	const firstChar = hash.charCodeAt(0);
	const secondChar = hash.charCodeAt(1);
	const thirdChar = hash.charCodeAt(2);
	const fourthChar = hash.charCodeAt(3);

	return firstChar === 36 && // '$'
		secondChar === 50 && // '2'
		(thirdChar === 97 || thirdChar === 98 || thirdChar === 121) && // 'a', 'b', or 'y'
		fourthChar === 36; // '$'
}

export function getPasswordHashType(hash: string): 'argon2id' | 'bcrypt' | 'unknown' {
	const checkers = [
		{ check: isArgon2Hash, type: 'argon2id' as const },
		{ check: isBcryptHash, type: 'bcrypt' as const }
	];

	return checkers.find(({ check }) => check(hash))?.type ?? 'unknown';
}
