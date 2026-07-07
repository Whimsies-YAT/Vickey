/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import promiseLimit from 'promise-limit';
import type { MiUser } from '@/models/_.js';
import { toArray, unique } from '@/misc/prelude/array.js';
import { bindThis } from '@/decorators.js';
import { isMention } from '../type.js';
import type { IObject, IApMention } from '../type.js';
import type { ApPersonServiceLike, ApResolverLike } from '../ap-service-contracts.js';

@Injectable()
export class ApMentionService implements OnModuleInit {
	private apPersonService: ApPersonServiceLike;

	constructor(
		private moduleRef: ModuleRef,
	) {
	}

	onModuleInit(): void {
		this.apPersonService = this.moduleRef.get('ApPersonService');
	}

	@bindThis
	public async extractApMentions(tags: IObject | IObject[] | null | undefined, resolver: ApResolverLike): Promise<MiUser[]> {
		const hrefs = unique(this.extractApMentionObjects(tags).map(x => x.href));

		const limit = promiseLimit<MiUser | null>(2);
		const mentionedUsers = (await Promise.all(
			hrefs.map(x => limit(() => this.apPersonService.resolvePerson(x, resolver).catch(() => null))),
		)).filter(x => x != null);

		return mentionedUsers;
	}

	@bindThis
	public extractApMentionObjects(tags: IObject | IObject[] | null | undefined): IApMention[] {
		if (tags == null) return [];
		return toArray(tags).filter(isMention);
	}
}
