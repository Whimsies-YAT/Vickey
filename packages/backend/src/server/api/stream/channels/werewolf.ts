/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class WerewolfChannel extends Channel {
	public readonly chName = 'werewolf';
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
		// Subscribe to global lobby events (all users see new games)
		this.subscriber.on('werewolfLobbyStream', this.send);
	}

	@bindThis
	public dispose() {
		// Unsubscribe from global lobby
		this.subscriber.off('werewolfLobbyStream', this.send);
	}
}

@Injectable()
export class WerewolfChannelService implements MiChannelService<true> {
	public readonly shouldShare = WerewolfChannel.shouldShare;
	public readonly requireCredential = WerewolfChannel.requireCredential;
	public readonly kind = WerewolfChannel.kind;

	constructor(
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): WerewolfChannel {
		return new WerewolfChannel(
			id,
			connection,
		);
	}
}