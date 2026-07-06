/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Packed } from '@/misc/json-schema.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import type { MiNote } from '@/models/Note.js';
import type { MiPage } from '@/models/Page.js';
import type { MiLocalUser, MiRemoteUser, MiUser } from '@/models/User.js';

type UserSchema = 'MeDetailed' | 'UserDetailedNotMe' | 'UserDetailed' | 'UserLite';

export type UserEntityServiceLike = {
	isLocalUser(user: MiUser): user is MiLocalUser;
	isRemoteUser(user: MiUser): user is MiRemoteUser;

	pack<S extends UserSchema = 'UserLite'>(
		src: MiUser['id'] | MiUser,
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			schema?: S,
			includeSecrets?: boolean,
		},
	): Promise<Packed<S>>;

	packMany<S extends UserSchema = 'UserLite'>(
		users: (MiUser['id'] | MiUser)[],
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			schema?: S,
			includeSecrets?: boolean,
		},
	): Promise<Packed<S>[]>;
};

export type NoteEntityServiceLike = {
	packMany(
		notes: MiNote[],
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			detail?: boolean,
			skipHide?: boolean,
			removeHide?: boolean,
		},
	): Promise<Packed<'Note'>[]>;
};

export type DriveFileEntityServiceLike = {
	getProxiedUrl(url: string, mode?: 'static' | 'avatar'): string;
	getPublicUrl(file: MiDriveFile, mode?: 'avatar', bypassProxy?: boolean): string;

	pack(
		src: MiDriveFile['id'] | MiDriveFile,
		options?: {
			detail?: boolean,
			self?: boolean,
			withUser?: boolean,
		},
	): Promise<Packed<'DriveFile'>>;

	packMany(
		files: MiDriveFile[],
		options?: {
			detail?: boolean,
			self?: boolean,
			withUser?: boolean,
		},
	): Promise<Packed<'DriveFile'>[]>;

	packManyByIds(fileIds: MiDriveFile['id'][]): Promise<Packed<'DriveFile'>[]>;

	packManyByIdsMap(
		fileIds: MiDriveFile['id'][],
		options?: {
			detail?: boolean,
			self?: boolean,
			withUser?: boolean,
		},
	): Promise<Map<Packed<'DriveFile'>['id'], Packed<'DriveFile'> | null>>;
};

export type PageEntityServiceLike = {
	pack(
		src: MiPage['id'] | MiPage,
		me?: { id: MiUser['id'] } | null | undefined,
	): Promise<Packed<'Page'>>;
};
