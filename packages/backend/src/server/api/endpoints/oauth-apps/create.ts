/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AppsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { unique } from '@/misc/prelude/array.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { AppEntityService } from '@/core/entities/AppEntityService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { permissions as allPermissions } from 'misskey-js';
import { ApiError } from "@/server/api/error.js";

export const meta = {
	tags: ['oauth-apps'],

	requireCredential: true,
	kind: 'write:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'App',
	},

	errors: {
		notAllowed: {
			message: 'Invalid permissions.',
			code: 'NOT_ALLOWED',
			id: '8893b521-7f6c-11f0-8aaf-b025aa6cce5f',
		}
	}
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', maxLength: 128 },
		description: { type: 'string', maxLength: 512 },
		permission: { type: 'array', uniqueItems: true, items: {
			type: 'string',
		} },
		callbackUrl: { type: 'string', nullable: true, maxLength: 512 },
		iconUrl: { type: 'string', nullable: true, maxLength: 512 },
		websiteUrl: { type: 'string', nullable: true, maxLength: 512 },
	},
	required: ['name', 'description', 'permission'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		private appEntityService: AppEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const secret = secureRndstr(32);

			// Filter out admin permissions for non-admin users
			const nonAdminPermissions = allPermissions.filter(p => !p.startsWith('read:admin:') && !p.startsWith('write:admin:'));

			const requestedPermissions = unique(ps.permission.map(v => v.replace(/^(.+)([\/\-])(read|write)$/, '$3:$1')));

			// Validate permissions - only allow non-admin permissions
			const invalidPermissions = requestedPermissions.filter(p => !nonAdminPermissions.includes(p as any));
			if (invalidPermissions.length > 0) {
				console.log(`Invalid permissions: ${invalidPermissions.join(', ')}`);
				throw new ApiError(meta.errors.notAllowed);
			}

			const permission = requestedPermissions;

			const appId = this.idService.gen();
			const clientId = `${this.config.url}/oauth/app/${appId}`;

			const app = await this.appsRepository.insertOne({
				id: appId,
				clientId: clientId,
				userId: me.id,
				name: ps.name,
				description: ps.description,
				permission,
				callbackUrl: ps.callbackUrl,
				secret: secret,
				isOAuth: true,
				iconUrl: ps.iconUrl,
				websiteUrl: ps.websiteUrl,
				createdAt: new Date(),
			});

			return await this.appEntityService.pack(app, me, {
				detail: true,
				includeSecret: true,
				includeFullSecret: true,
			});
		});
	}
}
