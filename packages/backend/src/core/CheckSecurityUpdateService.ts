/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import sanitizeHtml from 'sanitize-html';
import { EmailService } from '@/core/EmailService.js';
import { MetaService } from '@/core/MetaService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import {DI} from "@/di-symbols.js";

@Injectable()
export class CheckSecurityUpdateService{
	private logger: Logger;
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private emailService: EmailService,
		private metaService: MetaService,
		private httpRequestService: HttpRequestService
	) {}

	@bindThis
	public async checkSecUpdate(): Promise<void> {
		const version = this.config.version;

		let repoUrl = this.meta.repositoryUrl;
		if (!repoUrl) repoUrl = "https://github.com/misskey-dev/misskey";

		if (repoUrl.includes('github.com')) {
			const githubApiUrl = this.convertToGitHubApiUrl(repoUrl);

			try{
				const res = await this.httpRequestService.send(githubApiUrl, {
					method: 'GET',
					headers: {
						'Accept': 'application/vnd.github.v3+json',
					},
					timeout: 15000,
				});

				if (res.ok) {
					const releases = await res.json() as { tag_name: string; body: string, prerelease: boolean }[];

					const getVersionFromString = (str: string) => {
						const match = str.match(/(\d+\.\d+\.\d+)/);
						return match ? match[0] : null;
					};

					const latestRelease = releases[0];
					const latestVersion = getVersionFromString(latestRelease.tag_name);

					if (latestVersion && !version.includes(latestVersion)) {
						const compareVersions = (v1: string, v2: string) => {
							const v1Parts = v1.split('.').map(Number);
							const v2Parts = v2.split('.').map(Number);
							const len = Math.max(v1Parts.length, v2Parts.length);

							for (let i = 0; i < len; i++) {
								const part1 = v1Parts[i] || 0;
								const part2 = v2Parts[i] || 0;

								if (part1 > part2) return 1;
								if (part1 < part2) return -1;
							}
							return 0;
						};

						const versionComparison = compareVersions(version, latestVersion);
						if (versionComparison < 0) {
							for (const release of releases) {
								if (!release.prerelease && release.body && release.body.includes('SecurityReleaseSignal')) {
									if (this.meta.security) {
										// eslint-disable-next-line no-empty-character-class
										const emailRe = /^([!#-'*+/-9=?A-Z^-~-]+(\.[!#-'*+/-9=?A-Z^-~-]+)*|"([]!#-[^-~ \t]|(\\[\t -~]))+")@([0-9A-Za-z]([0-9A-Za-z-]{0,61}[0-9A-Za-z])?(\.[0-9A-Za-z]([0-9A-Za-z-]{0,61}[0-9A-Za-z])?)*|\[((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}|IPv6:((((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){6}|::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){5}|[0-9A-Fa-f]{0,4}::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){4}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):)?(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){3}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,2}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){2}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,3}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,4}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::)((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3})|(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3})|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,5}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3})|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,6}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::)|(?!IPv6:)[0-9A-Za-z-]*[0-9A-Za-z]:[!-Z^-~]+)])$/;
										if (
											this.meta.maintainerEmail &&
											emailRe.test(this.meta.maintainerEmail)
										) {
											await this.emailService.sendEmail(
												this.meta.maintainerEmail,
												"New Security Release Detected",
												sanitizeHtml(`Version ${release.tag_name} contains security updates!`),
												sanitizeHtml(`Version ${release.tag_name} contains security updates!`)
											)
										}
										const set = { security: false } as Partial<MiMeta>;
										await this.metaService.update(set);
									}
									return;
								}
							}
						}
					}
					const set = { security: true } as Partial<MiMeta>;
					await this.metaService.update(set);
				} else {
					console.error(`Failed to fetch GitHub release info: HTTP ${res.status}`);
				}
			} catch (e: unknown) {
				if (e instanceof Error) {
					console.error(e);
				} else {
					throw new Error('An unknown error occurred.');
				}
			}
		} else {
			this.logger.warn('Repo URL is not a GitHub repository. Skipping GitHub API fetch.');
		}
	}

	private convertToGitHubApiUrl(url: string): string {
		const match = /github\.com\/([^/]+)\/([^/]+)(\/|$)/.exec(url);
		if (!match) {
			throw new Error('Invalid GitHub repository URL');
		}
		const [_, owner, repo] = match;
		return `https://api.github.com/repos/${owner}/${repo}/releases`;
	}
}
