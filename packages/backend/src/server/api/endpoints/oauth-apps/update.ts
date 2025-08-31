/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AppsRepository } from '@/models/_.js';
import { AppEntityService } from '@/core/entities/AppEntityService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';
import { permissions as allPermissions } from 'misskey-js';
import { unique } from '@/misc/prelude/array.js';

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
		noSuchApp: {
			message: 'No such OAuth app.',
			code: 'NO_SUCH_OAUTH_APP',
			id: 'dce83914-2dc6-4093-8a7b-71dbb9043fa4'
		},
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
		appId: { type: 'string' },
		name: { type: 'string', maxLength: 128 },
		description: { type: 'string', maxLength: 512 },
		permission: { type: 'array', uniqueItems: true, items: {
			type: 'string',
		} },
		callbackUrl: { type: 'string', nullable: true, maxLength: 512 },
		iconUrl: { type: 'string', nullable: true, maxLength: 512 },
		websiteUrl: { type: 'string', nullable: true, maxLength: 512 },
	},
	required: ['appId', 'name', 'description'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		private appEntityService: AppEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const app = await this.appsRepository.findOneBy({
				id: ps.appId,
				userId: me.id,
				isOAuth: true,
			});

			if (app == null) {
				throw new ApiError(meta.errors.noSuchApp);
			}

			let permission = app.permission;
			if (ps.permission) {
				const nonAdminPermissions = allPermissions.filter(p => !p.startsWith('read:admin:') && !p.startsWith('write:admin:'));

				const requestedPermissions = unique(ps.permission.map(v => v.replace(/^(.+)([\/\-])(read|write)$/, '$3:$1')));

				const invalidPermissions = requestedPermissions.filter(p => !nonAdminPermissions.includes(p as any));
				if (invalidPermissions.length > 0) {
					console.log(`Invalid permissions: ${invalidPermissions.join(', ')}`);
					throw new ApiError(meta.errors.notAllowed);
				}

				permission = requestedPermissions;
			}

			await this.appsRepository.update(app.id, {
				name: ps.name,
				description: ps.description,
				permission: permission,
				callbackUrl: ps.callbackUrl,
				iconUrl: ps.iconUrl,
				websiteUrl: ps.websiteUrl,
			});

			return await this.appEntityService.pack(ps.appId, me, {
				detail: true,
				includeSecret: true,
			});
		});
	}
}
