/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Packed } from '@/misc/json-schema.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import { SmartTimelineService } from '@/core/SmartTimelineService.js';
import { isRenotePacked, isQuotePacked } from '@/misc/is-renote.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';

@Injectable({ scope: Scope.TRANSIENT })
export class SmartTimelineChannel extends Channel {
	public readonly chName = 'smartTimeline';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:account';

	private algorithm: string;
	private diversityLevel: string;
	private freshnessWeight: number;
	private qualityThreshold: number;
	private withRenotes: boolean;
	private withReplies: boolean;
	private withFiles: boolean;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private smartTimelineService: SmartTimelineService,
		private noteEntityService: NoteEntityService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject): Promise<void> {
		this.algorithm = (params.algorithm as string) ?? 'smart';
		this.diversityLevel = (params.diversityLevel as string) ?? 'medium';
		this.freshnessWeight = (params.freshnessWeight as number) ?? 0.3;
		this.qualityThreshold = (params.qualityThreshold as number) ?? 0.4;
		this.withRenotes = !!(params.withRenotes ?? true);
		this.withReplies = !!(params.withReplies ?? false);
		this.withFiles = !!(params.withFiles ?? false);

		// Subscribe events
		this.subscriber.on('notesStream', this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		if (!this.user) return;

		if (this.withFiles && (note.fileIds == null || note.fileIds.length === 0)) return;
		if (this.isNoteMutedOrBlocked(note)) return;

		try {
			if (note.visibility === 'followers') {
				const isMe = this.user.id === note.userId;
				if (!isMe && !Object.hasOwn(this.following, note.userId)) return;
			} else if (note.visibility === 'specified') {
				if (!note.visibleUserIds!.includes(this.user.id)) return;
			}

			if (note.reply) {
				const reply = note.reply;
				if (!this.withReplies) {
					if (reply.userId !== this.user.id && note.userId !== this.user.id && !Object.hasOwn(this.following, note.userId)) {
						return;
					}
				}

				if (reply.visibility === 'followers' && !Object.hasOwn(this.following, reply.userId) && reply.userId !== this.user.id) {
					return;
				}
			}

			if (isRenotePacked(note) && !isQuotePacked(note) && note.renote) {
				if (!this.withRenotes) return;
				if (note.renote.reply) {
					const reply = note.renote.reply;
					if (reply.visibility === 'followers' && !Object.hasOwn(this.following, reply.userId) && reply.userId !== this.user.id) {
						return;
					}
				}
			}

			const shouldInclude = await this.smartTimelineService.shouldIncludeInRealTimeStream(
				this.user,
				note,
				{
					algorithm: this.algorithm,
					diversityLevel: this.diversityLevel,
					freshnessWeight: this.freshnessWeight,
					qualityThreshold: this.qualityThreshold,
				},
			);

			if (!shouldInclude) return;

			if (this.user && note.renoteId && !note.text) {
				if (note.renote && Object.keys(note.renote.reactions).length > 0) {
					const myRenoteReaction = await this.noteEntityService.populateMyReaction(note.renote, this.user.id);
					note.renote.myReaction = myRenoteReaction;
				}
			}

			this.send('note', note);
		} catch (error) {
			console.error('Smart timeline stream error:', error);
		}
	}

	@bindThis
	public dispose(): void {
		this.subscriber.off('notesStream', this.onNote);
	}
}
