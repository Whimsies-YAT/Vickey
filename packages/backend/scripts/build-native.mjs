/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, '..');
const nativeDir = resolve(backendDir, 'native');
const builtDir = resolve(backendDir, 'built');
const builtNativeDir = resolve(builtDir, 'native');

function resolveCargo() {
	const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
	const result = spawnSync(cargo, ['--version'], { stdio: 'ignore' });
	if (result.status === 0) return cargo;

	const cargoHome = process.env.CARGO_HOME ?? resolve(process.env.HOME ?? '', '.cargo');
	const fallback = resolve(cargoHome, 'bin', cargo);
	if (existsSync(fallback)) return fallback;

	throw new Error('cargo is required to build backend native bindings');
}

function nativeTarget() {
	if (process.platform === 'linux' && process.arch === 'x64') {
		return {
			cargoOutput: 'libvickey_native.so',
			nodeOutput: 'vickey-native.linux-x64-gnu.node',
		};
	}

	throw new Error(`unsupported native target: ${process.platform}/${process.arch}`);
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'inherit',
		env: process.env,
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
	}
}

const target = nativeTarget();
const cargo = resolveCargo();

run(cargo, ['build', '--release'], nativeDir);

mkdirSync(builtNativeDir, { recursive: true });

const cargoArtifact = resolve(nativeDir, 'target/release', target.cargoOutput);
const nativeArtifact = resolve(nativeDir, target.nodeOutput);
const builtNativeArtifact = resolve(builtNativeDir, target.nodeOutput);
const builtRootArtifact = resolve(builtDir, target.nodeOutput);

copyFileSync(cargoArtifact, nativeArtifact);
copyFileSync(nativeArtifact, builtNativeArtifact);

// The bundler may inline native/index.js; keep the binary beside built/entry.js too.
copyFileSync(nativeArtifact, builtRootArtifact);

for (const file of ['index.js', 'index.d.ts', 'package.json']) {
	copyFileSync(resolve(nativeDir, file), resolve(builtNativeDir, file));
}

console.log(`[backend] native binding built: built/native/${target.nodeOutput}`);
