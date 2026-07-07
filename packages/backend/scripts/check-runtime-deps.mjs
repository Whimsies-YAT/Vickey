/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '../..');

function checkSlacc() {
	const slacc = require('slacc');
	const roots = [slacc, slacc.default, slacc['module.exports']].filter(Boolean);

	const get = (...names) => {
		for (const root of roots) {
			for (const name of names) {
				if (root?.[name] != null) return root[name];
			}
		}
		return undefined;
	};

	const checks = [
		['AhoCorasick/JsAhoCorasick', get('AhoCorasick', 'JsAhoCorasick'), value => typeof value?.withPatterns === 'function'],
		['RsaKeyPair/JsRsaKeyPair', get('RsaKeyPair', 'JsRsaKeyPair'), value => typeof value?.fromPem === 'function' && typeof value?.prototype?.sign === 'function'],
		['ZipReader/JsZipReader', get('ZipReader', 'JsZipReader'), value => typeof value?.withDestinationPath === 'function'],
		['init', get('init'), value => typeof value === 'function'],
	];

	for (const [name, value, isValid] of checks) {
		if (!isValid(value)) {
			throw new Error(`slacc export ${name} is missing or unusable`);
		}
	}
}

function checkBackendBundle() {
	const builtDir = path.join(backendRoot, 'built');
	const files = fs.readdirSync(builtDir).filter(file => file.endsWith('.js'));
	const stalePatterns = [
		'Cannot find native binding',
		'RsaKeyPair.prototype.sign',
	];

	for (const file of files) {
		const filePath = path.join(builtDir, file);
		const source = fs.readFileSync(filePath, 'utf8');
		for (const pattern of stalePatterns) {
			if (source.includes(pattern)) {
				throw new Error(`${path.relative(repoRoot, filePath)} contains stale bundled slacc code: ${pattern}`);
			}
		}
	}
}

async function checkStartupImports() {
	const builtDir = path.join(backendRoot, 'built');
	const apNoteFiles = fs.readdirSync(builtDir).filter(file => /^ApNoteService-.*\.js$/.test(file));
	const pushNotificationFiles = fs.readdirSync(builtDir).filter(file => /^PushNotificationService-.*\.js$/.test(file));

	if (apNoteFiles.length !== 1) {
		throw new Error(`Expected exactly one ApNoteService bundle, found ${apNoteFiles.length}: ${apNoteFiles.join(', ')}`);
	}

	if (pushNotificationFiles.length !== 1) {
		throw new Error(`Expected exactly one PushNotificationService bundle, found ${pushNotificationFiles.length}: ${pushNotificationFiles.join(', ')}`);
	}

	const pushNotificationBundle = fs.readFileSync(path.join(builtDir, pushNotificationFiles[0]), 'utf8');
	const bundledWebPushPatterns = [
		'function WebPushLib',
		'jwsSign',
		'function inherits',
	];

	for (const pattern of bundledWebPushPatterns) {
		if (pushNotificationBundle.includes(pattern)) {
			throw new Error(`PushNotificationService bundle contains bundled web-push code: ${pattern}`);
		}
	}

	await import(pathToFileURL(path.join(builtDir, apNoteFiles[0])).href);
	await import(pathToFileURL(path.join(builtDir, pushNotificationFiles[0])).href);
}

async function checkLocalAIContentAnalysisDeps() {
	const transformers = await import('@xenova/transformers');

	if (typeof transformers.pipeline !== 'function' || transformers.env == null) {
		throw new Error('@xenova/transformers does not expose the expected pipeline/env exports');
	}
}

checkSlacc();
checkBackendBundle();
await checkLocalAIContentAnalysisDeps();
await checkStartupImports();

console.log('Runtime dependency check passed');
