/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { load as loadYaml } from 'js-yaml';

function normalizeFlowCollectionClosingIndentation(yamlContent) {
	const lines = yamlContent.split(/\r?\n/);
	const stack = [];

	return lines.map((line) => {
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		const trimmed = line.trim();

		const activeFlow = stack.at(-1);
		if (activeFlow && indent === activeFlow.indent && trimmed === activeFlow.closer) {
			stack.pop();
			return `${' '.repeat(activeFlow.indent + 2)}${trimmed}`;
		}

		if (trimmed === '' || trimmed.startsWith('#')) {
			return line;
		}

		const content = line.replace(/\s+#.*$/, '').trimEnd();
		const opener = content.endsWith('[')
			? { indent, closer: ']' }
			: content.endsWith('{')
				? { indent, closer: '}' }
				: null;

		if (opener) {
			stack.push(opener);
		}

		return line;
	}).join('\n');
}

export function loadConfigYaml(yamlContent) {
	return loadYaml(normalizeFlowCollectionClosingIndentation(yamlContent));
}
