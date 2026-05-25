import { defineConfig } from 'rolldown';
import type { Plugin, ExternalOption } from 'rolldown';
import { execa, execaNode } from 'execa';
import type { ResultPromise } from 'execa';
import esmShim from '@rollup/plugin-esm-shim';

/**
 * Watchモード時にバックエンドの起動・停止制御を行うプラグイン
 */
function backendDevServerPlugin(): Plugin {
	let backendProcess: ResultPromise | null = null;

	async function runBuildAssets() {
		await execa('pnpm', ['run', 'build-assets'], {
			cwd: '../../',
			stdout: process.stdout,
			stderr: process.stderr,
		});
	}

	async function killBackendProcess() {
		if (backendProcess) {
			backendProcess.catch(() => {}); // backendProcess.kill()によって発生する例外を無視するためにcatch()を呼び出す
			backendProcess.kill();
			await new Promise(resolve => backendProcess!.on('exit', resolve));
			backendProcess = null;
		}
	}

	return {
		name: 'backend-dev-server',
		async closeBundle() {
			await runBuildAssets();
			if (backendProcess) {
				await killBackendProcess();
			}
			backendProcess = execaNode('./built/entry.js', [], {
				stdout: process.stdout,
				stderr: process.stderr,
				env: {
					NODE_ENV: 'development',
				},
			});
		},
		async watchChange() {
			if (backendProcess) {
				await killBackendProcess();
				await runBuildAssets();
			}
		},
	};
}

function nativeBuildPlugin(): Plugin {
	let buildPromise: Promise<void> | null = null;

	return {
		name: 'backend-native-build',
		async closeBundle() {
			buildPromise ??= execa('node', ['./scripts/build-native.mjs'], {
				stdout: process.stdout,
				stderr: process.stderr,
			}).then(() => undefined);
			await buildPromise;
		},
	};
}

export default defineConfig((args) => {
	const isWatchMode = args.watch != null && args.watch !== 'false';
	const isE2E = args.e2e != null && args.e2e !== 'false';

	// 通常のビルド時にexternalとするモジュール
	const externalModules: ExternalOption = [
		/^slacc-.*/,
		'class-transformer',
		'class-validator',
		/^@sentry\/.*/,
		/^@sentry-internal\/.*/,
		'@node-rs/argon2',
		/^@node-rs\/argon2-.*/,
		'koffi',
		'@nestjs/websockets/socket-module',
		'@nestjs/microservices/microservices-module',
		'@nestjs/microservices',
		/^@napi-rs\/.*/,
		'mock-aws-s3',
		'aws-sdk',
		'nock',
		'cld',
		'sharp',
		'jsdom',
		're2',
		'ipaddr.js',
		'oauth2orize',
		'file-type',
	];

	if (isE2E) {
		return {
			input: './test-server/entry.ts',
			platform: 'node',
			tsconfig: './test-server/tsconfig.json',
			plugins: [
				esmShim(),
				nativeBuildPlugin(),
			],
			output: {
				keepNames: true,
				sourcemap: true,
				dir: './built-test',
				cleanDir: true,
				format: 'esm',
			},
			external: externalModules,
		};
	} else {
		return {
			input: [
				'./src/boot/entry.ts',
				'./src/boot/cli.ts',
				'./src/config.ts',
				'./src/postgres.ts',
				'./src/server/api/openapi/gen-spec.ts',
			],
			platform: 'node',
			tsconfig: true,
			plugins: [
				esmShim(),
				nativeBuildPlugin(),
				(isWatchMode ? backendDevServerPlugin() : undefined),
			],
			output: {
				keepNames: true,
				minify: !isWatchMode,
				sourcemap: isWatchMode,
				dir: './built',
				cleanDir: !isWatchMode,
				format: 'esm',
			},
			watch: {
				include: ['src/**/*.{ts,js,mjs,cjs,tsx,json}'],
				clearScreen: false,
			},
			// ビルドの高速化のために、watchモードのときは外部モジュールは全てバンドルしないようにする
			external: isWatchMode ? /^(?!@\/)[^.\/](?!:[\/\\])/ : externalModules,
		};
	}
});
