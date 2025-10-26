/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { MiGomokuGame } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { GomokuService } from '@/core/GomokuService.js';
import { GomokuGameEntityService } from '@/core/entities/GomokuGameEntityService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class GomokuGameChannel extends Channel {
	public readonly chName = 'gomokuGame';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private gameId: MiGomokuGame['id'] | null = null;

	constructor(
		private gomokuService: GomokuService,
		private gomokuGameEntityService: GomokuGameEntityService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.gameId !== 'string') return;
		this.gameId = params.gameId;

		this.subscriber.on(`gomokuGameStream:${this.gameId}`, this.send);
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		switch (type) {
			case 'ready':
				if (typeof body !== 'boolean') return;
				this.ready(body);
				break;
			case 'cancel':
				this.cancelGame();
				break;
			case 'putStone':
				if (!isJsonObject(body)) return;
				if (typeof body.pos !== 'number') return;
				this.putStone(body.pos);
				break;
		}
	}

	@bindThis
	private async ready(ready: boolean) {
		if (this.user == null) return;

		this.gomokuService.gameReady(this.gameId!, this.user, ready);
	}

	@bindThis
	private async cancelGame() {
		if (this.user == null) return;

		this.gomokuService.cancelGame(this.gameId!, this.user);
	}

	@bindThis
	private async putStone(pos: number) {
		if (this.user == null) return;

		this.gomokuService.putStone(this.gameId!, this.user, pos);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`gomokuGameStream:${this.gameId}`, this.send);
	}
}

@Injectable()
export class GomokuGameChannelService implements MiChannelService<false> {
	public readonly shouldShare = GomokuGameChannel.shouldShare;
	public readonly requireCredential = GomokuGameChannel.requireCredential;
	public readonly kind = GomokuGameChannel.kind;

	constructor(
		private gomokuService: GomokuService,
		private gomokuGameEntityService: GomokuGameEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): GomokuGameChannel {
		return new GomokuGameChannel(
			this.gomokuService,
			this.gomokuGameEntityService,
			id,
			connection,
		);
	}
}
