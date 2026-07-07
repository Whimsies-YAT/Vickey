/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiDriveFile } from '@/models/DriveFile.js';
import type { MiEmoji } from '@/models/Emoji.js';
import type { MiNote } from '@/models/Note.js';
import type { IPoll } from '@/models/Poll.js';
import type { MiLocalUser, MiRemoteUser, MiUser } from '@/models/User.js';
import type { IApMention, ICollection, IObject, IOrderedCollection } from './type.js';
import type { ApObject } from './type.js';

export type ApResolverLike = {
	getHistory(): string[];
	getRecursionLimit(): number;
	resolveCollection(value: string | IObject): Promise<ICollection | IOrderedCollection>;
	resolve(value: string | IObject): Promise<IObject>;
};

export type ApResolverServiceLike = {
	createResolver(): Promise<ApResolverLike>;
};

export type UriParseResult = {
	local: true;
	id: string;
	type: string;
	rest?: string;
} | {
	local: false;
	uri: string;
};

export type ApDbResolverServiceLike = {
	parseUri(value: string | IObject): UriParseResult;
	getNoteFromApId(value: string | IObject): Promise<MiNote | null>;
};

export type ApPersonServiceLike = {
	fetchPerson(uri: string): Promise<MiLocalUser | MiRemoteUser | null>;
	resolvePerson(uri: string, resolver?: ApResolverLike): Promise<MiLocalUser | MiRemoteUser>;
};

export type ApNoteServiceLike = {
	extractEmojis(tags: IObject | IObject[], host: string): Promise<MiEmoji[]>;
	resolveNote(value: string | IObject, options?: { sentFrom?: URL, resolver?: ApResolverLike }): Promise<MiNote | null>;
};

export type AudienceInfo = {
	visibility: 'public' | 'home' | 'followers' | 'specified';
	mentionedUsers: MiUser[];
	visibleUsers: MiUser[];
};

export type ApAudienceServiceLike = {
	parseAudience(actor: MiRemoteUser, to?: ApObject, cc?: ApObject, resolver?: ApResolverLike): Promise<AudienceInfo>;
};

export type ApMentionServiceLike = {
	extractApMentions(tags: IObject | IObject[] | null | undefined, resolver: ApResolverLike): Promise<MiUser[]>;
	extractApMentionObjects(tags: IObject | IObject[] | null | undefined): IApMention[];
};

export type ApImageServiceLike = {
	resolveImage(actor: MiRemoteUser, value: string | IObject): Promise<MiDriveFile | null>;
};

export type ApQuestionServiceLike = {
	extractPollFromQuestion(source: string | IObject, resolver?: ApResolverLike): Promise<IPoll>;
	updateQuestion(value: string | IObject, actor?: MiRemoteUser, resolver?: ApResolverLike): Promise<boolean>;
};
