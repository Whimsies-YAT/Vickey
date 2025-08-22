/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { AccessTokensRepository, AppsRepository } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiApp } from '@/models/App.js';
import type { MiUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class AppEntityService {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,
	) {
	}

	@bindThis
	public async pack(
		src: MiApp['id'] | MiApp,
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			detail?: boolean,
			includeSecret?: boolean,
			includeFullSecret?: boolean,
			includeProfileImageIds?: boolean
		},
	): Promise<Packed<'App'>> {
		const opts = Object.assign({
			detail: false,
			includeSecret: false,
			includeFullSecret: false,
			includeProfileImageIds: false,
		}, options);

		const app = typeof src === 'object' ? src : await this.appsRepository.findOneByOrFail({ id: src });

		const formatSecret = (secret: string) => {
			if (opts.includeFullSecret) return secret;
			return secret.substring(0, 3) + '*'.repeat(28);
		};

		return {
			id: app.id,
			name: app.name,
			description: app.description,
			callbackUrl: app.callbackUrl,
			permission: app.permission,
			isOAuth: app.isOAuth,
			clientId: app.clientId,
			iconUrl: app.iconUrl,
			websiteUrl: app.websiteUrl,
			createdAt: app.createdAt.toISOString(),
			...(opts.includeSecret ? { secret: formatSecret(app.secret) } : {}),
			...(opts.includeFullSecret ? { fullSecret: app.secret } : {}),
			...(me ? {
				isAuthorized: await this.accessTokensRepository.countBy({
					appId: app.id,
					userId: me.id,
				}).then(count => count > 0),
			} : {}),
		};
	}
}
