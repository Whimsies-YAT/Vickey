/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { StripeService } from '@/core/StripeService.js';

export const meta = {
	tags: ['payment'],

	requireCredential: false,

	res: {
		type: 'object',
		properties: {
			enabled: {
				type: 'boolean',
			},
			publicKey: {
				type: 'string',
				nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private stripeService: StripeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const enabled = await this.stripeService.isEnabled();
			const publicKey = enabled ? await this.stripeService.getPublicKey() : null;

			return {
				enabled,
				publicKey,
			};
		});
	}
}
