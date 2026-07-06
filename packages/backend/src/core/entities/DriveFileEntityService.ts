/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { OnModuleInit } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { DriveFilesRepository, MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import type { Packed } from '@/misc/json-schema.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import type { MiUser } from '@/models/User.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { deepClone } from '@/misc/clone.js';
import { bindThis } from '@/decorators.js';
import { isMimeImage } from '@/misc/is-mime-image.js';
import { IdService } from '@/core/IdService.js';
import { uniqueByKey } from '@/misc/unique-by-key.js';
import { UtilityService } from '../UtilityService.js';
import { VideoProcessingService } from '../VideoProcessingService.js';
import type { UserEntityServiceLike } from './entity-service-contracts.js';
import { DriveFolderEntityService } from './DriveFolderEntityService.js';

type PackOptions = {
	detail?: boolean,
	self?: boolean,
	withUser?: boolean,
};

@Injectable()
export class DriveFileEntityService implements OnModuleInit {
	private userEntityService: UserEntityServiceLike;

	constructor(
		private moduleRef: ModuleRef,

		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private utilityService: UtilityService,
		private driveFolderEntityService: DriveFolderEntityService,
		private videoProcessingService: VideoProcessingService,
		private idService: IdService,
	) {
	}

	onModuleInit(): void {
		this.userEntityService = this.moduleRef.get('UserEntityService');
	}

	@bindThis
	public validateFileName(name: string): boolean {
		return (
			(name.trim().length > 0) &&
			(name.length <= 200) &&
			(name.indexOf('\\') === -1) &&
			(name.indexOf('/') === -1) &&
			(name.indexOf('..') === -1)
		);
	}

	@bindThis
	public getPublicProperties(file: MiDriveFile): MiDriveFile['properties'] {
		if (file.properties.orientation != null) {
			const properties = deepClone(file.properties);
			if (file.properties.orientation >= 5) {
				[properties.width, properties.height] = [properties.height, properties.width];
			}
			properties.orientation = undefined;
			return properties;
		}

		return file.properties;
	}

	@bindThis
	private getProxiedUrlPrivate(url: string, mode?: 'static' | 'avatar'): string {
		const modeType = mode || 'image';
		return appendQuery(
			`${this.config.mediaProxy}/${modeType}.webp`,
			query(mode ? { url, [mode]: '1' } : { url })
		);
	}

	@bindThis
	public getProxiedUrl(url: string, mode?: 'static' | 'avatar'): string {
		if (!this.config.externalMediaProxyEnabled) {
			return url;
		}

		return this.getProxiedUrlPrivate(url, mode);
	}

	@bindThis
	public getThumbnailUrl(file: MiDriveFile): string | null {
		if (file.type.startsWith('video')) {
			if (file.thumbnailUrl) return file.thumbnailUrl;

			return this.videoProcessingService.getExternalVideoThumbnailUrl(file.webpublicUrl ?? file.url);
		} else if (file.uri != null && file.userHost != null && this.config.externalMediaProxyEnabled) {
			// 動画ではなくリモートかつメディアプロキシ
			return this.getProxiedUrlPrivate(file.uri, 'static');
		}

		if (file.uri != null && file.isLink && this.meta.proxyRemoteFiles) {
			// リモートかつ期限切れはローカルプロキシを試みる
			// 従来は/files/${thumbnailAccessKey}にアクセスしていたが、
			// /filesはメディアプロキシにリダイレクトするようにしたため直接メディアプロキシを指定する
			return this.getProxiedUrlPrivate(file.uri, 'static');
		}

		const url = file.webpublicUrl ?? file.url;

		return file.thumbnailUrl ?? (isMimeImage(file.type, 'sharp-convertible-image') ? url : null);
	}

	@bindThis
	public getPublicUrl(file: MiDriveFile, mode?: 'avatar', bypassProxy?: boolean): string { // static = thumbnail
		// リモートかつメディアプロキシ
		if (!bypassProxy && file.uri != null && file.userHost != null && this.config.externalMediaProxyEnabled) {
			return this.getProxiedUrlPrivate(file.uri, mode);
		}

		// リモートかつ期限切れはローカルプロキシを試みる
		if (!bypassProxy && file.uri != null && file.isLink && this.meta.proxyRemoteFiles) {
			const key = file.webpublicAccessKey;

			if (key && !key.match('/')) {	// 古いものはここにオブジェクトストレージキーが入ってるので除外
				const url = `${this.config.url}/files/${key}`;
				if (!bypassProxy && mode === 'avatar') return this.getProxiedUrlPrivate(file.uri, 'avatar');
				return url;
			}
		}

		const url = file.webpublicUrl ?? file.url;

		if (!bypassProxy && mode === 'avatar') {
			return this.getProxiedUrlPrivate(url, 'avatar');
		}
		return url;
	}

	@bindThis
	public async calcDriveUsageOf(user: MiUser['id'] | { id: MiUser['id'] }): Promise<number> {
		const id = typeof user === 'object' ? user.id : user;

		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userId = :id', { id: id })
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfHost(host: string): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost = :host', { host: this.utilityService.toPuny(host) })
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfLocal(): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost IS NULL')
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfRemote(): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost IS NOT NULL')
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async pack(
		src: MiDriveFile['id'] | MiDriveFile,
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>> {
		const opts = Object.assign({
			detail: false,
			self: false,
		}, options);

		const file = typeof src === 'object' ? src : await this.driveFilesRepository.findOneByOrFail({ id: src });

		return await awaitAll<Packed<'DriveFile'>>({
			id: file.id,
			createdAt: this.idService.parse(file.id).date.toISOString(),
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: file.blurhash,
			properties: opts.self ? file.properties : this.getPublicProperties(file),
			url: opts.self ? file.url : this.getPublicUrl(file),
			thumbnailUrl: this.getThumbnailUrl(file),
			comment: file.comment,
			folderId: file.folderId,
			folder: opts.detail && file.folderId ? this.driveFolderEntityService.pack(file.folderId, {
				detail: true,
			}) : null,
			userId: opts.withUser ? file.userId : null,
			user: (opts.withUser && file.userId) ? this.userEntityService.pack(file.userId) : null,
		});
	}

	@bindThis
	public async packNullable(
		src: MiDriveFile['id'] | MiDriveFile,
		options?: PackOptions,
		hint?: {
			packedUser?: Packed<'UserLite'>
			packedFolder?: Packed<'DriveFolder'>
		},
	): Promise<Packed<'DriveFile'> | null> {
		const opts = Object.assign({
			detail: false,
			self: false,
		}, options);

		const file = typeof src === 'object' ? src : await this.driveFilesRepository.findOneBy({ id: src });
		if (file == null) return null;

		return await awaitAll<Packed<'DriveFile'>>({
			id: file.id,
			createdAt: this.idService.parse(file.id).date.toISOString(),
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: file.blurhash,
			properties: opts.self ? file.properties : this.getPublicProperties(file),
			url: opts.self ? file.url : this.getPublicUrl(file),
			thumbnailUrl: this.getThumbnailUrl(file),
			comment: file.comment,
			folderId: file.folderId,
			folder: opts.detail && file.folderId ? (hint?.packedFolder ?? this.driveFolderEntityService.pack(file.folderId, {
				detail: true,
			})) : null,
			userId: file.userId,
			user: (opts.withUser && file.userId) ? hint?.packedUser ?? this.userEntityService.pack(file.userId) : null,
		});
	}

	@bindThis
	public async packMany(
		files: MiDriveFile[],
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>[]> {
		// -- ユーザ情報の事前取得 --

		let userMap: Map<string, Packed<'UserLite'>> | null = null;
		if (options?.withUser) {
			const users = files
				.map(({ userId }) => userId)
				.filter(x => x != null);

			const uniqueUsers = uniqueByKey(users, user => user);
			const packedUsers = await this.userEntityService.packMany(uniqueUsers);
			userMap = new Map(packedUsers.map(user => [user.id, user]));
		}

		// -- フォルダ情報の事前取得 --

		let folderMap: Map<string, Packed<'DriveFolder'>> | null = null;
		if (options?.detail) {
			const folders = files
				.map(({ folderId }) => folderId)
				.filter(x => x != null);

			const uniqueFolders = uniqueByKey(folders, folder => folder);
			const packedFolders = await this.driveFolderEntityService.packMany(uniqueFolders, { detail: true });
			folderMap = new Map(packedFolders.map(folder => [folder.id, folder]));
		}

		const items = await Promise.all(files.map(f => this.packNullable(
			f,
			options,
			{
				packedUser: f.userId ? userMap?.get(f.userId) : undefined,
				packedFolder: f.folderId ? folderMap?.get(f.folderId) : undefined,
			},
		)));

		return items.filter(x => x != null);
	}

	@bindThis
	public async packManyByIdsMap(
		fileIds: MiDriveFile['id'][],
		options?: PackOptions,
	): Promise<Map<Packed<'DriveFile'>['id'], Packed<'DriveFile'> | null>> {
		if (fileIds.length === 0) return new Map();
		const files = await this.driveFilesRepository.findBy({ id: In(fileIds) });
		const packedFiles = await this.packMany(files, options);
		const map = new Map<Packed<'DriveFile'>['id'], Packed<'DriveFile'> | null>(packedFiles.map(f => [f.id, f]));
		for (const id of fileIds) {
			if (!map.has(id)) map.set(id, null);
		}
		return map;
	}

	@bindThis
	public async packManyByIds(
		fileIds: MiDriveFile['id'][],
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>[]> {
		if (fileIds.length === 0) return [];
		const filesMap = await this.packManyByIdsMap(fileIds, options);
		return fileIds.map(id => filesMap.get(id)).filter(x => x != null);
	}
}
