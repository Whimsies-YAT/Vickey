/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { getEndpointParamDef } from '../endpoint-metadata.js';
import type { Schema } from '@/misc/json-schema.js';

export const meta = {
	requireCredential: false,

	tags: ['meta'],

	res: {
		type: 'object',
		nullable: true,
		properties: {
			params: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						type: { type: 'string' },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		endpoint: { type: 'string' },
	},
	required: ['endpoint'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
	) {
		super(meta, paramDef, async (ps) => {
			const endpointParamDef: Schema | null = ps.endpoint === 'endpoint'
				? paramDef
				: await getEndpointParamDef(ps.endpoint);
			if (endpointParamDef == null) return null;

			return {
				params: Object.entries(endpointParamDef.properties ?? {}).map(([k, v]) => ({
					name: k,
					type: v.type ? v.type.charAt(0).toUpperCase() + v.type.slice(1) : 'string',
				})),
			};
		});
	}
}
