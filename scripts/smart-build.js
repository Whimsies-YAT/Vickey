#!/usr/bin/env node
/*
 * Smart build script that conditionally builds misskey-js
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function exec(cmd, options = {}) {
	console.log(`\x1b[36m$ ${cmd}\x1b[0m`);
	try {
		execSync(cmd, {
			cwd: rootDir,
			stdio: 'inherit',
			...options
		});
		return true;
	} catch (error) {
		return false;
	}
}

function main() {
	console.log('\x1b[1m=== Smart Build ===\x1b[0m\n');

	console.log('\x1b[1m[1/5] Running build-pre...\x1b[0m');
	if (!exec('pnpm build-pre')) {
		console.error('\x1b[31m✗ build-pre failed\x1b[0m');
		process.exit(1);
	}
	console.log('');

	console.log('\x1b[1m[2/5] Building backend (generates endpoint-list)...\x1b[0m');
	if (!exec('pnpm --filter backend build')) {
		console.error('\x1b[31m✗ Backend build failed\x1b[0m');
		process.exit(1);
	}
	console.log('');

	console.log('\x1b[1m[3/5] Checking and building misskey-js...\x1b[0m');
	const needsMisskeyJsRebuild = !exec('node scripts/check-misskey-js.js', { stdio: 'inherit' });

	if (needsMisskeyJsRebuild) {
		console.log('[smart-build] Building misskey-js with type generation...\n');
		if (!exec('pnpm run build-misskey-js-only')) {
			console.error('\x1b[31m✗ misskey-js build failed\x1b[0m');
			process.exit(1);
		}
	} else {
		console.log('\x1b[32m[smart-build] ✓ Skipped misskey-js rebuild\x1b[0m\n');
	}

	console.log('\x1b[1m[4/5] Building remaining packages...\x1b[0m');
	console.log('[smart-build] Building frontend, sw, etc.\n');
	if (!exec('pnpm -r --filter=!backend --filter=!misskey-js build')) {
		console.error('\x1b[31m✗ Package build failed\x1b[0m');
		process.exit(1);
	}
	console.log('');

	console.log('\x1b[1m[5/5] Building assets...\x1b[0m');
	if (!exec('pnpm build-assets')) {
		console.error('\x1b[31m✗ build-assets failed\x1b[0m');
		process.exit(1);
	}

	console.log('\n\x1b[1m\x1b[32m=== Build Complete ===\x1b[0m\n');
}

main();
