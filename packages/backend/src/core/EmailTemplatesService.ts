/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { EmailService } from '@/core/EmailService.js';
import type { MiMeta, EmailTemplatesRepository, UserProfilesRepository } from '@/models/_.js';
import { MiEmailTemplates } from '@/models/EmailTemplates.js';
import { bindThis } from '@/decorators.js';
import { DI } from "@/di-symbols.js";
import type { Config } from '@/config.js';

@Injectable()
export class EmailTemplatesService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.config)
		private config: Config,

		@Inject(DI.emailTemplatesRepository)
		private emailTemplatesRepository: EmailTemplatesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private emailService: EmailService
	) {}

	@bindThis
	public async sendEmailWithTemplates(to: string, key: string, context?: Record<string, any>): Promise<boolean> {
		if (!this.meta.enableEmailTemplates) return false;

		const template = await this.emailTemplatesRepository.findOneBy({ key: key });
		if (!template?.enabled || !template?.content.length) return false;

		const subject = await this.replaceVariables(to, template.content[0], context);
		const message = await this.replaceVariables(to, template.content[1], context);
		const messageText = sanitizeHtml(message, { allowedTags: ['br'], allowedAttributes: {} }).replace(/<br\s*\/?>/g, '\n');
		await this.emailService.sendEmail(to, subject, sanitizeHtml(message), messageText);
		return true;
	}

	@bindThis
	public async customEmailTemplates(key: string, sub: string, msg: string, enabled: boolean = false): Promise<boolean> {
		if (!await this.emailTemplatesRepository.findOneBy({ key: key })) return false;
		const template = new MiEmailTemplates();
		template.key = key;
		template.content = [sub, msg];
		template.enabled = enabled;
		await this.emailTemplatesRepository.save(template);
		return true;
	}

	/**
	 * @deprecated This method is deprecated, use showAllTemplates instead.
	 */
	@bindThis
	public async showTemplates(key: string): Promise<MiEmailTemplates | boolean> {
		if (!key) return false;
		const result = await this.emailTemplatesRepository.findOneBy({ key: key });
		return result || false;
	}

	@bindThis
	public async showAllTemplates(): Promise<MiEmailTemplates[]> {
		const results = await this.emailTemplatesRepository.find();
		return results.length > 0 ? results : [];
	}

	private async replaceVariables(
		to: string,
		text: string,
		context: Record<string, any> = {}
	): Promise<string> {
		const userProfile = await this.userProfilesRepository.findOneBy({ email: to });
		const presetVariables: Record<string, string> = {
			instanceHost: this.config.host,
			instanceName: this.meta.name ?? this.config.host,
			maintainerName: this.meta.maintainerName ?? '',
			maintainerEmail: this.meta.maintainerEmail ?? '',
			contact: this.meta.impressumUrl ?? '',
			senderEmail: this.meta.email ?? '',
			receiverName: userProfile?.emailVerified ? userProfile.user?.name ?? '' : '',
			receiverEmail: to,
		};

		return text.replace(/\${(.*?)}/g, (match, expression) => {
			const key = expression.trim();

			if (Object.prototype.hasOwnProperty.call(presetVariables, key)) {
				return presetVariables[key];
			}

			try {
				const keys = Object.keys(context);
				const values = Object.values(context);
				const fn = new Function(...keys, `return ${key};`);
				return fn(...values);
			} catch (e) {
				console.error(`Error evaluating expression: ${expression}`, e);
				return '';
			}
		});
	}
}
