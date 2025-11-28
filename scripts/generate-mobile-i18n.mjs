#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const localesDir = path.join(repoRoot, 'vickey-locales');
const outputDir = path.join(repoRoot, 'android', 'app', 'src', 'main', 'assets', 'i18n');

const MOBILE_KEYS = [
  'mobile.serverSetup.title',
  'mobile.serverSetup.description',
  'mobile.serverSetup.placeholder',
  'mobile.serverSetup.connect',
  'mobile.serverSetup.invalidUrl',
  'mobile.rootWarning.title',
  'mobile.rootWarning.message',
  'mobile.rootWarning.proceed'
];

function getByPath(source, dotPath) {
  return dotPath.split('.').reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (Object.prototype.hasOwnProperty.call(current, segment)) {
      return current[segment];
    }
    return undefined;
  }, source);
}

async function generate() {
  const files = await fs.readdir(localesDir);
  await fs.mkdir(outputDir, { recursive: true });

  for (const fileName of files) {
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) continue;
    const localePath = path.join(localesDir, fileName);
    const fileContent = await fs.readFile(localePath, 'utf8');
    const parsed = yaml.load(fileContent);

    const translations = {};
    for (const key of MOBILE_KEYS) {
      const value = getByPath(parsed, key);
      if (value === undefined) {
        console.warn(`[mobile-i18n] Missing key "${key}" in ${fileName}`);
        continue;
      }
      translations[key] = value;
    }

    const localeId = path.basename(fileName, path.extname(fileName));
    const outputPath = path.join(outputDir, `${localeId}.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(translations, null, 2)}\n`, 'utf8');
    console.info(`[mobile-i18n] Wrote ${outputPath}`);
  }
}

generate().catch((error) => {
  console.error('[mobile-i18n] Failed to generate mobile i18n files');
  console.error(error);
  process.exit(1);
});
