/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {Inject, Injectable} from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { AvatarDecorationService } from '@/core/AvatarDecorationService.js';
import { IdService } from '@/core/IdService.js';
import {DI} from "@/di-symbols.js";

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireRolePolicy: 'canManageAvatarDecorations',
	kind: 'write:admin:avatar-decorations',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			createdAt: {
				type: 'string',
				optional: false, nullable: false,
				format: 'date-time',
			},
			updatedAt: {
				type: 'string',
				optional: false, nullable: true,
				format: 'date-time',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			description: {
				type: 'string',
				optional: false, nullable: false,
			},
			url: {
				type: 'string',
				optional: false, nullable: false,
			},
			roleIdsThatCanBeUsedThisDecoration: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1 },
		description: { type: 'string' },
		url: { type: 'string', minLength: 1 },
		roleIdsThatCanBeUsedThisDecoration: { type: 'array', items: {
			type: 'string',
		} },
	},
	required: ['name', 'description', 'url'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private avatarDecorationService: AvatarDecorationService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const adExist = await this.driveFilesRepository.findOneBy({ url: ps.url });
			const created = await this.avatarDecorationService.create({
				name: ps.name,
				description: ps.description,
				url: ps.url,
				roleIdsThatCanBeUsedThisDecoration: ps.roleIdsThatCanBeUsedThisDecoration,
				driveId: adExist?.id ?? undefined,
			}, me);

			return {
				id: created.id,
				createdAt: this.idService.parse(created.id).date.toISOString(),
				updatedAt: null,
				name: created.name,
				description: created.description,
				url: created.url,
				roleIdsThatCanBeUsedThisDecoration: created.roleIdsThatCanBeUsedThisDecoration,
				driveId: created.driveId,
			};
		});
	}
}
