/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require('fs');
const path = require('path');
const { join, dirname} = require("path");
const { execSync } = require('child_process');
const packageJsonPath = __dirname + '/../package.json'

function buildYumePdq() {
	console.log('Building yume-pdq...');
	try {
		execSync('bash ./scripts/build-yume-pdq.sh', {
			cwd: path.join(__dirname, '..'),
			stdio: 'inherit'
		});
		console.log('yume-pdq build completed successfully');
	} catch (error) {
		console.warn('yume-pdq build failed, continuing without it:', error.message);
	}
}

function build() {
	buildYumePdq();

	try {
		const json = fs.readFileSync(packageJsonPath, 'utf-8')
		const meta = JSON.parse(json);
		fs.mkdirSync(__dirname + '/../built', { recursive: true });
		fs.writeFileSync(__dirname + '/../built/meta.json', JSON.stringify({ version: meta.version, codename: meta.codename.replace(/^[a-z]/, c => c.toUpperCase()) }), 'utf-8');
		const maxTime = Date.now() + 183 * 24 * 60 * 60 * 1000;
		const defaultTime = { version: '1', time: maxTime };
		const tokenSettingsPath = join(__dirname, '/../files/settings/tokenSettings.json');
		fs.mkdirSync(path.dirname(tokenSettingsPath), { recursive: true });

		let writeDefault = false;
		let data = Object.assign({}, defaultTime);

		try {
			if (!fs.existsSync(tokenSettingsPath) || fs.statSync(tokenSettingsPath).size === 0) {
				writeDefault = true;
			} else {
				const raw = fs.readFileSync(tokenSettingsPath, 'utf-8');
				const parsed = JSON.parse(raw.toString('utf-8'));

				if (!parsed.version || !parsed.time) {
					writeDefault = true;
				} else {
					data = parsed;
					if (data.time > maxTime) {
						data.time = maxTime;
						writeDefault = true;
					}
				}
			}
		} catch (err) {
			writeDefault = true;
		}

		if (writeDefault) {
			fs.writeFileSync(tokenSettingsPath, JSON.stringify(data, null, 2), 'utf-8');
		}
	} catch (e) {
		console.error(e)
	}
}

build();

if (process.argv.includes("--watch")) {
	fs.watch(packageJsonPath, (event, filename) => {
		console.log(`update ${filename} ...`)
		build()
	})
}
