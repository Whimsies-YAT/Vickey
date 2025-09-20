/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ValueTransformer } from 'typeorm';

export const vectorTransformer: ValueTransformer = {
	to(value: number[] | null): string | null {
		if (!value || !Array.isArray(value)) return null;
		const validNumbers = value.every(n => !isNaN(n));
		if (!validNumbers) {
			throw new Error('Vector array must contain only valid numbers');
		}
		return `[${value.join(',')}]`;
	},

	from(value: string | null): number[] | null {
		if (!value) return null;
		try {
			const cleaned = value.replace(/^\[|]$/g, '').trim();
			if (!cleaned) return null;

			return cleaned.split(',').map(str => {
				const num = parseFloat(str.trim());
				if (isNaN(num)) {
					throw new Error(`Invalid number in vector: ${str}`);
				}
				return num;
			});
		} catch (error) {
			console.error('Error parsing vector from database:', error);
			return null;
		}
	},
};

// Since TypeORM doesn't support vector type natively and driver classes are not accessible,
// we'll handle vector columns manually through raw SQL queries.

declare module 'typeorm' {
	interface ColumnTypes {
		vector: string;
	}
}
