#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const rootPackageJson = path.join(rootDir, 'package.json');
const mjsPackageJson = path.join(rootDir, 'packages/misskey-js/package.json');
const backendDir = path.join(rootDir, 'packages/backend');
const autogenDir = path.join(rootDir, 'packages/misskey-js/src/autogen');
const generatedAutogenDir = path.join(rootDir, 'packages/misskey-js/generator/built/autogen');
let apiJsonGenerated = false;

function runCommand(cmd, label) {
	console.log(`[misskey-js] ${label}`);
	try {
		execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
		return true;
	} catch (error) {
		console.log(`[misskey-js] ❌ ${label} failed`, error?.message ?? '');
		return false;
	}
}

function regenerateApiJson() {
	apiJsonGenerated = runCommand('pnpm --filter backend generate-api-json --no-build', 'Generating API JSON (backend)');
	return apiJsonGenerated;
}

function regenerateAutogenTypes() {
	return runCommand('pnpm --filter misskey-js-type-generator generate', 'Regenerating misskey-js types');
}

function compareAutogenWithGenerated() {
	if (!fs.existsSync(generatedAutogenDir)) {
		console.log('[misskey-js] ⚠ Generated autogen directory not found');
		return 'needs-rebuild';
	}
	if (!fs.existsSync(autogenDir)) {
		console.log('[misskey-js] ⚠ Repository autogen directory missing');
		return 'needs-rebuild';
	}

	const diff = spawnSync('diff', ['-qr', generatedAutogenDir, autogenDir], {
		cwd: rootDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf-8',
	});

	if (diff.status === 0) {
		console.log('[misskey-js] ✓ Autogen files match generated output');
		return 'match';
	}

	if (diff.status === 1) {
		console.log('[misskey-js] ⚠ Autogen mismatch detected (diff excerpt below)\n');
		console.log(diff.stdout || diff.stderr || '(diff output empty)');
		return 'mismatch';
	}

	console.log('[misskey-js] ⚠ Failed to compare autogen directories:', diff.stderr || diff.error?.message);
	return 'needs-rebuild';
}

/**
 * Version consistency
 */
function checkVersionMatch() {
	const rootMeta = JSON.parse(fs.readFileSync(rootPackageJson, 'utf-8'));
	const mjsMeta = JSON.parse(fs.readFileSync(mjsPackageJson, 'utf-8'));

	if (rootMeta.version !== mjsMeta.version) {
		console.log('[misskey-js] ❌ Version mismatch detected:');
		console.log(`  Root: ${rootMeta.version}`);
		console.log(`  misskey-js: ${mjsMeta.version}`);
		return false;
	}

	console.log(`[misskey-js] ✓ Version matched: ${rootMeta.version}`);
	return true;
}

/**
 * API changes detection via api.json comparison
 * More accurate than checking backend file changes
 */
function checkApiJsonChanges() {
	const apiJsonPath = path.join(rootDir, 'packages/backend/built/api.json');
	const generatorApiJsonPath = path.join(rootDir, 'packages/misskey-js/generator/api.json');

	try {
		if (!regenerateApiJson()) {
			console.log('[misskey-js] ⚠ api.json generation failed, cannot verify');
			return 'needs-rebuild';
		}

		if (!fs.existsSync(apiJsonPath)) {
			console.log('[misskey-js] ⚠ api.json was not written by backend generation');
			return 'needs-rebuild';
		}

		if (!fs.existsSync(generatorApiJsonPath)) {
			console.log('[misskey-js] ℹ No previous api.json, first build');
			return 'needs-rebuild';
		}

		const currentApiJson = fs.readFileSync(apiJsonPath, 'utf-8');
		const previousApiJson = fs.readFileSync(generatorApiJsonPath, 'utf-8');

		if (currentApiJson !== previousApiJson) {
			console.log('[misskey-js] ⚠ API definition changed');
			return 'api-changed';
		}

		console.log('[misskey-js] ✓ API definition unchanged');
		return 'no-changes';
	} catch (error) {
		console.log('[misskey-js] ⚠ Error checking api.json:', error.message);
		return 'needs-rebuild';
	}
}

/**
 * Autogen files existence
 */
function checkAutogenExists() {
	if (!fs.existsSync(autogenDir)) {
		console.log('[misskey-js] ❌ Autogen directory missing');
		return false;
	}

	const files = fs.readdirSync(autogenDir);
	if (files.length === 0) {
		console.log('[misskey-js] ❌ Autogen directory is empty');
		return false;
	}

	console.log('[misskey-js] ✓ Autogen files exist');
	return true;
}

/**
 * misskey-js built files existence
 */
function checkMisskeyJsBuilt() {
	const builtDir = path.join(rootDir, 'packages/misskey-js/built');

	if (!fs.existsSync(builtDir)) {
		console.log('[misskey-js] ❌ Built directory missing');
		return false;
	}

	const files = fs.readdirSync(builtDir);
	if (files.length === 0) {
		console.log('[misskey-js] ❌ Built directory is empty');
		return false;
	}

	console.log('[misskey-js] ✓ Built files exist');
	return true;
}

/**
 * Main check function
 */
function main() {
	console.log('[misskey-js] Checking if misskey-js rebuild is needed...\n');

	let needsRebuild = false;
	const reasons = [];

	if (!checkVersionMatch()) {
		needsRebuild = true;
		reasons.push('version mismatch');
	}

	if (!checkAutogenExists()) {
		needsRebuild = true;
		reasons.push('autogen files missing');
	}

	if (!checkMisskeyJsBuilt()) {
		needsRebuild = true;
		reasons.push('built files missing');
	}

	const apiStatus = checkApiJsonChanges();
	if (apiStatus === 'api-changed') {
		needsRebuild = true;
		reasons.push('API definition changed');
	} else if (apiStatus === 'needs-rebuild') {
		needsRebuild = true;
		reasons.push('api.json verification failed or missing');
	}

	if (!needsRebuild) {
		const apiReady = apiJsonGenerated || regenerateApiJson();
		const autogenReady = apiReady && regenerateAutogenTypes();

		if (!apiReady || !autogenReady) {
			needsRebuild = true;
			reasons.push('autogen regeneration failed');
		} else {
			const diffStatus = compareAutogenWithGenerated();
			if (diffStatus !== 'match') {
				needsRebuild = true;
				reasons.push('autogen mismatch (regenerate types)');
			}
		}
	}

	console.log('');

	if (needsRebuild) {
		console.log('[misskey-js] ⚡ Rebuild REQUIRED');
		console.log(`[misskey-js] Reason: ${reasons.join(', ')}\n`);
		process.exit(1);
	} else {
		console.log('[misskey-js] ✓ Rebuild NOT needed - skipping\n');
		process.exit(0);
	}
}

main();
