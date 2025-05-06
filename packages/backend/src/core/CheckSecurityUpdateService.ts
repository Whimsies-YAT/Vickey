/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import sanitizeHtml from 'sanitize-html';
import { EmailService } from '@/core/EmailService.js';
import { EmailTemplatesService } from '@/core/EmailTemplatesService.js';
import { MetaService } from '@/core/MetaService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import { DI } from "@/di-symbols.js";

@Injectable()
export class CheckSecurityUpdateService {
	private logger: Logger;
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private loggerService: LoggerService,
		private emailService: EmailService,
		private emailTemplatesService: EmailTemplatesService,
		private metaService: MetaService,
		private httpRequestService: HttpRequestService
	) {
		this.logger = this.loggerService.getLogger('checkSec');
	}

	@bindThis
	public async checkSecUpdate(): Promise<void> {
		const currentVersion = this.config.version;

		let repoUrl = this.meta.repositoryUrl;
		if (!repoUrl) repoUrl = "https://github.com/Whimsies-YAT/Vickey";

		if (!repoUrl.includes('github.com')) {
			this.logger.warn('Repo URL is not a GitHub repository. Skipping GitHub API fetch.');
			return;
		}

		try {
			const githubApiUrl = this.convertToGitHubApiUrl(repoUrl);
			this.logger.info(`Checking for security updates from: ${githubApiUrl}`);

			const res = await this.httpRequestService.send(githubApiUrl, {
				method: 'GET',
				headers: {
					'Accept': 'application/vnd.github.v3+json',
				},
				timeout: 15000,
			});

			if (!res.ok) {
				this.logger.error(`Failed to fetch GitHub release info: HTTP ${res.status}`);
				return;
			}

			const releases = await res.json() as { tag_name: string; body: string, prerelease: boolean }[];

			if (!releases || releases.length === 0) {
				this.logger.warn('No releases found in the repository');
				return;
			}

			let securityUpdateFound = false;

			const latestRelease = releases[0];

			if (!latestRelease.prerelease && this.needsUpdate(currentVersion, latestRelease.tag_name)) {
				this.logger.info(`Newer version detected: ${latestRelease.tag_name}`);
			}

			for (const release of releases) {
				if (release.prerelease) continue;

				if (this.needsUpdate(currentVersion, release.tag_name) &&
					release.body &&
					release.body.includes('SecurityReleaseSignal')) {
					securityUpdateFound = true;
					const tag = release.tag_name;

					this.logger.info(`Security update found in version ${tag}`);

					if (this.meta.security && this.meta.maintainerEmail) {
						// eslint-disable-next-line no-empty-character-class
						const emailRe = /^([!#-'*+/-9=?A-Z^-~-]+(\.[!#-'*+/-9=?A-Z^-~-]+)*|"([]!#-[^-~ \t]|(\\[\t -~]))+")@([0-9A-Za-z]([0-9A-Za-z-]{0,61}[0-9A-Za-z])?(\.[0-9A-Za-z]([0-9A-Za-z-]{0,61}[0-9A-Za-z])?)*|\[((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}|IPv6:((((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){6}|::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){5}|[0-9A-Fa-f]{0,4}::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){4}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):)?(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){3}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,2}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){2}|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,3}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,4}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::)((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3})|(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3})|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,5}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3})|(((0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}):){0,6}(0|[1-9A-Fa-f][0-9A-Fa-f]{0,3}))?::)|(?!IPv6:)[0-9A-Za-z-]*[0-9A-Za-z]:[!-Z^-~]+)])$/;

						if (emailRe.test(this.meta.maintainerEmail)) {
							const tag = release.tag_name;
							const result = await this.emailTemplatesService.sendEmailWithTemplates(this.meta.maintainerEmail, 'secRelease', { tag });
							if (!result) {
								await this.emailService.sendEmail(
									this.meta.maintainerEmail,
									"New Security Release Detected",
									sanitizeHtml(`Version ${tag} contains security updates!`),
									sanitizeHtml(`Version ${tag} contains security updates!`)
								);
							}
						} else {
							this.logger.warn(`Invalid maintainer email: ${this.meta.maintainerEmail}`);
						}
					}

					await this.metaService.update({ security: false } as Partial<MiMeta>);
					break;
				}
			}

			if (!securityUpdateFound) {
				await this.metaService.update({ security: true } as Partial<MiMeta>);
			}
		} catch (error) {
			this.logger.error('Error checking for security updates:', error ?? 'Unknown error occurred.');
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

	private parseVersion(versionStr: string): {
		major: number;
		minor: number;
		patch: number;
		prerelease: string | null;
		isPrerelease: boolean;
	} | null {
		versionStr = versionStr.replace(/^[^0-9]+/, '');

		const regex = /^(\d+)\.(\d+)\.(\d+)(?:[.-]([a-zA-Z0-9._-]+))?/;
		const match = versionStr.match(regex);

		if (!match) return null;

		const [_, majorStr, minorStr, patchStr, suffixStr] = match;

		const isPrerelease = suffixStr
			? /^(alpha|beta|rc|dev|preview|test)/i.test(suffixStr)
			: false;

		return {
			major: parseInt(majorStr, 10),
			minor: parseInt(minorStr, 10),
			patch: parseInt(patchStr, 10),
			prerelease: suffixStr || null,
			isPrerelease
		};
	}

	private compareVersions(v1: string, v2: string): number {
		const parsedV1 = this.parseVersion(v1);
		const parsedV2 = this.parseVersion(v2);

		if (!parsedV1 || !parsedV2) {
			this.logger.warn(`Could not parse versions: "${v1}" or "${v2}"`);
			return 0;
		}

		if (parsedV1.major !== parsedV2.major) {
			return parsedV1.major > parsedV2.major ? 1 : -1;
		}

		if (parsedV1.minor !== parsedV2.minor) {
			return parsedV1.minor > parsedV2.minor ? 1 : -1;
		}

		if (parsedV1.patch !== parsedV2.patch) {
			return parsedV1.patch > parsedV2.patch ? 1 : -1;
		}

		if (parsedV1.isPrerelease && !parsedV2.isPrerelease) {
			return -1;
		}

		if (!parsedV1.isPrerelease && parsedV2.isPrerelease) {
			return 1;
		}

		if (parsedV1.isPrerelease && parsedV2.isPrerelease) {
			return (parsedV1.prerelease || '') < (parsedV2.prerelease || '') ? -1 : 1;
		}

		if (parsedV1.prerelease && !parsedV2.prerelease) {
			return 1;
		}

		if (!parsedV1.prerelease && parsedV2.prerelease) {
			return -1;
		}

		if (parsedV1.prerelease && parsedV2.prerelease) {
			return (parsedV1.prerelease || '') < (parsedV2.prerelease || '') ? -1 : 1;
		}

		return 0;
	}

	private needsUpdate(currentVersion: string, releaseVersion: string): boolean {
		const parsedCurrent = this.parseVersion(currentVersion);
		const parsedRelease = this.parseVersion(releaseVersion);

		if (!parsedCurrent || !parsedRelease) {
			return false;
		}

		if (parsedCurrent.isPrerelease &&
			parsedCurrent.major === parsedRelease.major &&
			parsedCurrent.minor === parsedRelease.minor &&
			parsedCurrent.patch === parsedRelease.patch &&
			!parsedRelease.isPrerelease) {
			return true;
		}

		if (!parsedCurrent.prerelease &&
			parsedRelease.prerelease &&
			!parsedRelease.isPrerelease &&
			parsedCurrent.major === parsedRelease.major &&
			parsedCurrent.minor === parsedRelease.minor &&
			parsedCurrent.patch === parsedRelease.patch) {
			return true;
		}

		return this.compareVersions(currentVersion, releaseVersion) < 0;
	}
}
