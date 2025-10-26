/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class GomokuChannel extends Channel {
	public readonly chName = 'gomoku';
	public static shouldShare = true;
	public static requireCredential = true as const;
	public static kind = 'read:account';

	constructor(
		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
	}

	@bindThis
	public async init(params: JsonObject) {
		this.subscriber.on(`gomokuStream:${this.user!.id}`, this.send);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`gomokuStream:${this.user!.id}`, this.send);
	}
}

@Injectable()
export class GomokuChannelService implements MiChannelService<true> {
	public readonly shouldShare = GomokuChannel.shouldShare;
	public readonly requireCredential = GomokuChannel.requireCredential;
	public readonly kind = GomokuChannel.kind;

	constructor(
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): GomokuChannel {
		return new GomokuChannel(
			id,
			connection,
		);
	}
}
