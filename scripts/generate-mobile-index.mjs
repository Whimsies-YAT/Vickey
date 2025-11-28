#!/usr/bin/env node
/**
 * Generate index.html for mobile from Vite manifest
 *
 * Since Misskey uses server-side rendering, there's no static index.html.
 * For Capacitor, we need to generate one dynamically from the build manifest.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const manifestPath = path.join(rootDir, 'built/_frontend_vite_/manifest.json');
const outputPath = path.join(rootDir, 'built/_frontend_vite_/index.html');

if (!fs.existsSync(manifestPath)) {
	console.error('❌ Manifest not found. Please build frontend first: pnpm --filter frontend build');
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// Find entry point (_boot_.ts)
let entryFile = null;
let cssFiles = [];

for (const [key, value] of Object.entries(manifest)) {
	if (value.src === 'src/_boot_.ts' && value.isEntry) {
		entryFile = value.file;
		cssFiles = value.css || [];
		break;
	}
}

if (!entryFile) {
	console.error('❌ Entry point not found in manifest');
	process.exit(1);
}

// Generate HTML
const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
	<meta name="format-detection" content="telephone=no">
	<meta name="mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="theme-color" content="#86b300">
	<meta property="instance_url" content="__SERVER_URL_PLACEHOLDER__" id="instance-url-meta">
	<script>
		// Android native injection - must run BEFORE any module script
		try {
			if (typeof AndroidBridge !== 'undefined') {
				const serverUrl = AndroidBridge.getServerUrl();
				document.getElementById('instance-url-meta').content = serverUrl;
				console.log('[Mobile] Server URL loaded from AndroidBridge:', serverUrl);
			}
		} catch (e) {
			console.error('[Mobile] Failed to get server URL from AndroidBridge:', e);
		}
	</script>
	<title>Vickey</title>
	${cssFiles.map(css => `<link rel="stylesheet" href="/${css}">`).join('\n\t')}
</head>
<body>
	<div id="misskey_app"></div>
	<script type="module" src="/${entryFile}"></script>
	<noscript>
		<p style="text-align:center;padding:2em;color:#666;">JavaScript is required to run this application.</p>
	</noscript>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);

console.log('✅ Generated index.html for mobile');
console.log(`   Entry: /${entryFile}`);
if (cssFiles.length > 0) {
	console.log(`   CSS: ${cssFiles.map(f => `/${f}`).join(', ')}`);
}