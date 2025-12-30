/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import type { MiGomokuGame } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { GomokuService } from '@/core/GomokuService.js';
import { GomokuGameEntityService } from '@/core/entities/GomokuGameEntityService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class GomokuGameChannel extends Channel {
	public readonly chName = 'gomokuGame';
	public static shouldShare = false;
	public static requireCredential = false as const;
	public static kind = null;
	private gameId: MiGomokuGame['id'] | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private gomokuService: GomokuService,
		private gomokuGameEntityService: GomokuGameEntityService,
	) {
		super(request);
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
