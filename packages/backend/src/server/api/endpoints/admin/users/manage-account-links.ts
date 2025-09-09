/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { MultiAccountDetectionService } from '@/core/MultiAccountDetectionService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	secure: true,
	kind: 'write:admin:risk-scores',

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '6c3f3b3a-4c3f-4c3f-8c3f-3c3f3b3a4c3f',
		},
		invalidOperation: {
			message: 'Invalid operation.',
			code: 'INVALID_OPERATION',
			id: '7d3f3b3a-5c3f-4c3f-8c3f-3c3f3b3a5c3f',
		},
		linkNotFound: {
			message: 'Account link not found.',
			code: 'LINK_NOT_FOUND',
			id: '8e3f3b3a-6c3f-4c3f-8c3f-3c3f3b3a6c3f',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		operation: {
			type: 'string',
			enum: ['create', 'remove', 'list', 'getNetwork'],
		},
		userId: {
			type: 'string',
			format: 'misskey:id',
		},
		userIds: {
			type: 'array',
			items: {
				type: 'string',
				format: 'misskey:id',
			},
		},
		linkId: {
			type: 'string',
		},
		groupName: {
			type: 'string',
		},
		groupDescription: {
			type: 'string',
		},
	},
	required: ['operation'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private multiAccountDetectionService: MultiAccountDetectionService,
	) {
		super(meta, paramDef, async (ps, me) => {
			switch (ps.operation) {
				case 'create': {
					if (!ps.userIds || ps.userIds.length < 2) {
						throw new ApiError(meta.errors.invalidOperation);
					}

					const users = await this.usersRepository.findBy({
						id: ps.userIds as any,
					});

					if (users.length !== ps.userIds.length) {
						throw new ApiError(meta.errors.noSuchUser);
					}

					const result = await this.multiAccountDetectionService.createMultiAccountGroup(
						ps.userIds,
						{
							isLinked: true,
							confidence: 1.0,
							methods: ['admin_manual'],
							evidence: {
								adminId: me.id,
								createdAt: new Date(),
								groupName: ps.groupName,
								groupDescription: ps.groupDescription,
							},
						},
						true
					);

					return {
						success: true,
						group: result,
					};
				}

				case 'remove': {
					if (!ps.linkId) {
						throw new ApiError(meta.errors.invalidOperation);
					}

					const success = await this.multiAccountDetectionService.removeAccountLink(ps.linkId);

					if (!success) {
						throw new ApiError(meta.errors.linkNotFound);
					}

					return {
						success: true,
					};
				}

				case 'list': {
					if (!ps.userId) {
						throw new ApiError(meta.errors.invalidOperation);
					}

					const user = await this.usersRepository.findOneBy({ id: ps.userId });
					if (!user) {
						throw new ApiError(meta.errors.noSuchUser);
					}

					const links = await this.multiAccountDetectionService.getAccountLinks(ps.userId);

					return {
						success: true,
						links,
					};
				}

				case 'getNetwork': {
					if (!ps.userId) {
						throw new ApiError(meta.errors.invalidOperation);
					}

					const user = await this.usersRepository.findOneBy({ id: ps.userId });
					if (!user) {
						throw new ApiError(meta.errors.noSuchUser);
					}

					const network = await this.multiAccountDetectionService.getAccountNetwork(ps.userId);

					return {
						success: true,
						network,
					};
				}

				default:
					throw new ApiError(meta.errors.invalidOperation);
			}
		});
	}
}
