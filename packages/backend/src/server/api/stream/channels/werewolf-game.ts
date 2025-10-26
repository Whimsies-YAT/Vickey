/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { MiWerewolfGame } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { WerewolfService } from '@/core/WerewolfService.js';
import { WerewolfGameEntityService } from '@/core/entities/WerewolfGameEntityService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class WerewolfGameChannel extends Channel {
	public readonly chName = 'werewolfGame';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private gameId: MiWerewolfGame['id'] | null = null;

	constructor(
		private werewolfService: WerewolfService,
		private werewolfGameEntityService: WerewolfGameEntityService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.gameId !== 'string') return;
		this.gameId = params.gameId;

		this.subscriber.on(`werewolfGameStream:${this.gameId}`, this.send);
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		switch (type) {
			case 'ready':
				if (typeof body !== 'boolean') return;
				this.ready(body);
				break;
			case 'action':
				if (!isJsonObject(body)) return;
				if (typeof body.action !== 'string') return;
				this.action(body.action, typeof body.target === 'string' ? body.target : undefined);
				break;
		}
	}

	@bindThis
	private async ready(ready: boolean) {
		if (this.user == null) return;

		if (ready) {
			this.werewolfService.setReady(this.gameId!, this.user);
		} else {
			this.werewolfService.setUnready(this.gameId!, this.user);
		}
	}

	@bindThis
	private async action(action: string, target?: string) {
		if (this.user == null) return;

		this.werewolfService.performAction(this.gameId!, this.user, action, target);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`werewolfGameStream:${this.gameId}`, this.send);
	}
}

@Injectable()
export class WerewolfGameChannelService implements MiChannelService<false> {
	public readonly shouldShare = WerewolfGameChannel.shouldShare;
	public readonly requireCredential = WerewolfGameChannel.requireCredential;
	public readonly kind = WerewolfGameChannel.kind;

	constructor(
		private werewolfService: WerewolfService,
		private werewolfGameEntityService: WerewolfGameEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): WerewolfGameChannel {
		return new WerewolfGameChannel(
			this.werewolfService,
			this.werewolfGameEntityService,
			id,
			connection,
		);
	}
}
