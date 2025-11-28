/* tslint:disable */
/* eslint-disable */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let nativeBinding = null;

const { platform, arch } = process;

switch (platform) {
  case 'linux':
    switch (arch) {
      case 'x64':
        try {
          nativeBinding = require(join(__dirname, 'vickey-native.linux-x64-gnu.node'));
        } catch (e) {
          throw new Error(`Failed to load native binding: ${e.message}`);
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`);
    }
    break;
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`);
}

if (!nativeBinding) {
  throw new Error('Failed to load native binding');
}

export const { normalizeForSearch, safeForSql, GeocodingIndex, generateIdenticon, htmlToMfm } = nativeBinding;
