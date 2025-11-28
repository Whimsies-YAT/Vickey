#!/usr/bin/env node
/**
 * Apply platform-specific overrides to built frontend
 *
 * Usage:
 *   node scripts/apply-overrides.mjs android
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const platform = process.argv[2];

if (!platform || platform !== 'android') {
	console.error('Usage: node apply-overrides.mjs android');
	process.exit(1);
}

console.log(`📱 Applying ${platform} overrides...`);

const overridesConfigPath = path.join(rootDir, platform, 'overrides.json');

if (!fs.existsSync(overridesConfigPath)) {
	console.log('⚠️  No overrides.json found, skipping');
	process.exit(0);
}

const config = JSON.parse(fs.readFileSync(overridesConfigPath, 'utf-8'));

if (!config.overrides || config.overrides.length === 0) {
	console.log('✓ No overrides defined');
	process.exit(0);
}

let appliedCount = 0;
let skippedCount = 0;

for (const override of config.overrides) {
	const sourcePath = path.join(rootDir, platform, override.source);
	const targetPath = path.join(rootDir, platform, override.target);

	if (!fs.existsSync(sourcePath)) {
		console.log(`⚠️  Source not found: ${override.source}`);
		skippedCount++;
		continue;
	}

	// Ensure target directory exists
	const targetDir = path.dirname(targetPath);
	if (!fs.existsSync(targetDir)) {
		fs.mkdirSync(targetDir, { recursive: true });
	}

	// Copy file
	fs.copyFileSync(sourcePath, targetPath);
	console.log(`✓ ${override.source} → ${override.target}`);
	if (override.description) {
		console.log(`  ${override.description}`);
	}
	appliedCount++;
}

console.log(`\n✅ Applied ${appliedCount} override(s), skipped ${skippedCount}`);