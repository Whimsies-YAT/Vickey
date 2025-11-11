/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URL, domainToASCII } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import RE2 from 're2';
import semver from 'semver';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { MiMeta, SoftwareSuspension } from '@/models/Meta.js';
import { MiInstance } from '@/models/Instance.js';

type TrieNode = { [key: string]: TrieNode } & { $?: true };

@Injectable()
export class UtilityService {
	private hostTrieCache = new Map<string, TrieNode>();
	private exactHostSetCache = new Map<string, Set<string>>();
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,
	) {
	}

	@bindThis
	private normalizeHost(host: string): string {
		return this.toPuny(host.toLowerCase());
	}

	@bindThis
	private buildHostTrie(domains: string[]): TrieNode {
		const root: TrieNode = {};
		for (const domain of domains) {
			if (!domain) continue;
			const parts = this.normalizeHost(domain).split('.').reverse();
			let node = root;
			for (const part of parts) {
				node = node[part] ||= {};
			}
			node.$ = true;
		}
		return root;
	}

	@bindThis
	private getHostTrie(domains: string[]): TrieNode {
		const key = JSON.stringify([...domains].sort());
		if (!this.hostTrieCache.has(key)) {
			this.hostTrieCache.set(key, this.buildHostTrie(domains));
		}
		return this.hostTrieCache.get(key)!;
	}

	@bindThis
	private getExactHostSet(domains: string[]): Set<string> {
		const key = JSON.stringify([...domains].sort());
		if (!this.exactHostSetCache.has(key)) {
			const set = new Set(domains.map(h => this.normalizeHost(h)));
			this.exactHostSetCache.set(key, set);
		}
		return this.exactHostSetCache.get(key)!;
	}

	@bindThis
	private isHostInTrie(trie: TrieNode, host: string | null): boolean {
		if (!host) return false;
		const parts = this.normalizeHost(host).split('.').reverse();
		let node = trie;
		for (const part of parts) {
			if (node.$) return true;
			if (!(part in node)) return false;
			node = node[part];
		}
		return !!node.$;
	}

	@bindThis
	public getFullApAccount(username: string, host: string | null): string {
		return host ? `${username}@${this.toPuny(host)}` : `${username}@${this.toPuny(this.config.host)}`;
	}

	@bindThis
	public isSelfHost(host: string | null): boolean {
		if (host == null) return true;
		return this.toPuny(this.config.host) === this.toPuny(host);
	}

	@bindThis
	public isUriLocal(uri: string): boolean {
		return this.punyHost(uri) === this.toPuny(this.config.host);
	}

	// メールアドレスのバリデーションを行う
	// https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
	@bindThis
	public validateEmailFormat(email: string): boolean {
		const regexp = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
		return regexp.test(email);
	}

	@bindThis
	public isBlockedHost(domains: string[] | undefined, host: string | null): boolean {
		if (!domains || !host) return false;
		const trie = this.getHostTrie(domains);
		return this.isHostInTrie(trie, host);
	}

	@bindThis
	public isExactHost(domains: string[] | undefined, host: string | null): boolean {
		if (!domains || !host) return false;
		const set = this.getExactHostSet(domains);
		return set.has(this.normalizeHost(host));
	}

	@bindThis
	public isSilencedHost(silencedHosts: string[] | undefined, host: string | null): boolean {
		return this.isBlockedHost(silencedHosts, host);
	}

	@bindThis
	public isMediaSilencedHost(silencedHosts: string[] | undefined, host: string | null): boolean {
		return this.isExactHost(silencedHosts, host);
	}

	@bindThis
	public concatNoteContentsForKeyWordCheck(content: {
		cw?: string | null;
		text?: string | null;
		pollChoices?: string[] | null;
		others?: string[] | null;
	}): string {
		/**
		 * ノートの内容を結合してキーワードチェック用の文字列を生成する
		 * cwとtextは内容が繋がっているかもしれないので間に何も入れずにチェックする
		 */
		return `${content.cw ?? ''}${content.text ?? ''}\n${(content.pollChoices ?? []).join('\n')}\n${(content.others ?? []).join('\n')}`;
	}

	@bindThis
	public isKeyWordIncluded(text: string, keyWords: string[]): boolean {
		if (keyWords.length === 0) return false;
		if (text === '') return false;

		const regexpregexp = /^\/(.+)\/(.*)$/;

		const matched = keyWords.some(filter => {
			// represents RegExp
			const regexp = filter.match(regexpregexp);
			// This should never happen due to input sanitisation.
			if (!regexp) {
				const words = filter.split(' ');
				return words.every(keyword => text.includes(keyword));
			}
			try {
				// TODO: RE2インスタンスをキャッシュ
				return new RE2(regexp[1], regexp[2]).test(text);
			} catch (err) {
				// This should never happen due to input sanitisation.
				return false;
			}
		});

		return matched;
	}

	@bindThis
	public extractDbHost(uri: string): string {
		const url = new URL(uri);
		return this.toPuny(url.host);
	}

	@bindThis
	public toPuny(host: string): string {
		return domainToASCII(host.toLowerCase());
	}

	@bindThis
	public toPunyNullable(host: string | null | undefined): string | null {
		if (host == null) return null;
		return domainToASCII(host.toLowerCase());
	}

	@bindThis
	public punyHost(url: string): string {
		const urlObj = new URL(url);
		const host = `${this.toPuny(urlObj.hostname)}${urlObj.port.length > 0 ? ':' + urlObj.port : ''}`;
		return host;
	}

	@bindThis
	public isFederationAllowedHost(host: string): boolean {
		if (this.isSelfHost(host)) return true;
		if (this.meta.federation === 'none') return false;
		if (this.meta.federation === 'specified' && !this.meta.federationHosts.some(x => `.${host.toLowerCase()}`.endsWith(`.${x}`))) return false;
		if (this.isBlockedHost(this.meta.blockedHosts, host)) return false;

		return true;
	}

	@bindThis
	public isFederationAllowedUri(uri: string): boolean {
		const host = this.extractDbHost(uri);
		return this.isFederationAllowedHost(host);
	}

	@bindThis
	public isDeliverSuspendedSoftware(software: Pick<MiInstance, 'softwareName' | 'softwareVersion'>): SoftwareSuspension | undefined {
		if (software.softwareName == null) return undefined;
		if (software.softwareVersion == null) {
			// software version is null; suspend iff versionRange is *
			return this.meta.deliverSuspendedSoftware.find(x =>
				x.software === software.softwareName
				&& x.versionRange.trim() === '*');
		} else {
			const softwareVersion = software.softwareVersion;
			return this.meta.deliverSuspendedSoftware.find(x =>
				x.software === software.softwareName
				&& semver.satisfies(softwareVersion, x.versionRange, { includePrerelease: true }));
		}
	}
}
