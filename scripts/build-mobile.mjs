#!/usr/bin/env node
/**
 * Build and sync mobile app
 *
 * Usage:
 *   node scripts/build-mobile.mjs android
 *   node scripts/build-mobile.mjs all
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build as buildLocales } from '../locales/index.js';
import meta from '../package.json' with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const platform = process.argv[2];
const skipBuild = process.argv.includes('--skip-build');

if (!platform || !['android', 'all'].includes(platform)) {
	console.error('Usage: node build-mobile.mjs <android|all> [--skip-build]');
	process.exit(1);
}

function run(command, cwd = rootDir) {
	console.log(`> ${command}`);
	execSync(command, { cwd, stdio: 'inherit' });
}

async function generateMobileLocales() {
	console.log('🌐 Generating locale files for mobile...');

	// Build locales from YAML sources
	const locales = buildLocales();

	// Create locales directory in mobile build output
	const localesDir = path.join(rootDir, 'built/_frontend_vite_/assets/locales');
	await fs.promises.mkdir(localesDir, { recursive: true });

	// Version metadata
	const versionInfo = { '_version_': meta.version };

	// Write JSON file for each locale
	for (const [lang, locale] of Object.entries(locales)) {
		const outputPath = path.join(localesDir, `${lang}.${meta.version}.json`);
		await fs.promises.writeFile(
			outputPath,
			JSON.stringify({ ...locale, ...versionInfo }),
			'utf-8'
		);
	}

	console.log(`   ✅ Generated ${Object.keys(locales).length} locale files`);
}

async function buildPlatform(targetPlatform) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`📱 Building ${targetPlatform.toUpperCase()}`);
	console.log(`${'='.repeat(60)}\n`);

	// Step 1: Build frontend (if not skipped)
	if (!skipBuild) {
		console.log('📦 Building frontend for mobile (base: /)...');
		run('BUILD_TARGET=mobile pnpm build', path.join(rootDir, 'packages/frontend'));
	} else {
		console.log('⏭️  Skipping frontend build (--skip-build)');
	}

	// Step 1.5: Generate locale files
	console.log('');
	await generateMobileLocales();

	// Step 2: Generate mobile index.html
	console.log(`\n📄 Generating mobile index.html...`);
	run(`node scripts/generate-mobile-index.mjs`, rootDir);

	// Step 3: Capacitor sync
	console.log(`\n🔄 Syncing to ${targetPlatform}...`);
	run(`pnpm exec cap sync ${targetPlatform}`, path.join(rootDir, 'packages/frontend'));

	// Step 4: Apply overrides
	console.log(`\n🎨 Applying ${targetPlatform} overrides...`);
	run(`node scripts/apply-overrides.mjs ${targetPlatform}`, rootDir);

	console.log(`\n✅ ${targetPlatform.toUpperCase()} build complete!`);

	// Platform-specific instructions
	if (targetPlatform === 'android') {
		console.log('\n📱 Next steps:');
		console.log('   cd android');
		console.log('   ./gradlew assembleDebug  # For debug build');
		console.log('   # Or open in Android Studio:');
		console.log('   pnpm mobile:open:android');
	}
}

// Build for specified platform(s)
(async () => {
	if (platform === 'all') {
		try {
			await buildPlatform('android');
			console.log(`\n${'='.repeat(60)}`);
			console.log('🎉 All platforms built successfully!');
			console.log(`${'='.repeat(60)}\n`);
		} catch (error) {
			console.error('\n❌ Android build failed:');
			console.error(error.message);
			process.exit(1);
		}
	} else {
		await buildPlatform(platform);
		console.log(`\n${'='.repeat(60)}`);
		console.log('🎉 All done!');
		console.log(`${'='.repeat(60)}\n`);
	}
})();