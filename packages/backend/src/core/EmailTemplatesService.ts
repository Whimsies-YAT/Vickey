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
import { decode } from 'he';

interface TemplateContext {
	[key: string]: string | number | boolean | Date | Record<string, any>;
}

interface PresetVariables {
	instanceUrl: string;
	instanceHost: string;
	instanceName: string;
	maintainerName: string;
	maintainerEmail: string;
	contact: string;
	senderEmail: string;
	receiverName: string;
	receiverEmail: string;
	iconUrl: string;
	emailSettingUrl: string;
}

@Injectable()
export class EmailTemplatesService {
	private readonly ALLOWED_VARIABLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

	private readonly MAX_REPLACEMENT_DEPTH = 10;

	private readonly HTML_SANITIZE_OPTIONS_STRICT = {
		allowedTags: [],
		allowedAttributes: {},
		disallowedTagsMode: 'discard' as const,
		allowedSchemes: [],
		allowedSchemesAppliedToAttributes: [],
		allowProtocolRelative: false
	};

	private readonly HTML_SANITIZE_OPTIONS_EMAIL = {
		allowedTags: [
			'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'div',
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'ul', 'ol', 'li',
			'a', 'img',
			'table', 'thead', 'tbody', 'tr', 'td', 'th'
		],
		allowedAttributes: {
			'a': ['href', 'title'],
			'img': ['src', 'alt', 'width', 'height'],
			'*': ['style', 'class']
		},
		allowedStyles: {
			'*': {
				'color': [/^#[0-9a-fA-F]{6}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
				'background-color': [/^#[0-9a-fA-F]{6}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
				'font-size': [/^\d+px$/, /^\d+em$/, /^\d+%$/],
				'text-align': [/^(left|right|center|justify)$/],
				'font-weight': [/^(normal|bold|\d{3})$/]
			}
		},
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesAppliedToAttributes: ['href', 'src'],
		allowedSchemesByTag: {
			img: ['http', 'https', 'data']
		},
		allowProtocolRelative: false,
		disallowedTagsMode: 'discard' as const,
		transformTags: {
			'img': (tagName: string, attribs: any) => {
				if (attribs.src && attribs.src.startsWith('data:') && !attribs.src.startsWith('data:image/')) {
					attribs.src = '';
				}
				return { tagName, attribs };
			}
		}
	};
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
	public async sendEmailWithTemplates(to: string, key: string, context?: TemplateContext): Promise<boolean> {
		if (!this.meta.enableEmailTemplates) return false;

		if (!this.isValidTemplateKey(key)) {
			return false;
		}

		const template = await this.emailTemplatesRepository.findOneBy({ key: key });
		if (!template?.enabled || !Array.isArray(template.content) || template.content.length < 2) {
			return false;
		}

		try {
			const subject = await this.replaceVariables(to, template.content[0], context, false);
			const message = await this.replaceVariables(to, template.content[1], context, true);

			const sanitizedSubject = sanitizeHtml(subject, this.HTML_SANITIZE_OPTIONS_STRICT);
			const sanitizedMessage = sanitizeHtml(message, this.HTML_SANITIZE_OPTIONS_EMAIL);
			const messageText = this.htmlToPlainText(sanitizedMessage);

			await this.emailService.sendEmail(to, sanitizedSubject, sanitizedMessage, messageText);
			return true;
		} catch (error) {
			console.error('Email template processing failed', { key, error: (error as Error).message });
			return false;
		}
	}

	@bindThis
	public async sendEmailWithTemplatesBcc(options: {
		key: string;
		bcc?: boolean;
		to: string | string[];
		context?: TemplateContext;
	}): Promise<boolean> {
		const { key, bcc = false, to, context } = options;

		if (!this.meta.enableEmailTemplates) {
			return false;
		}

		if (!this.isValidTemplateKey(key)) {
			return false;
		}

		const template = await this.emailTemplatesRepository.findOneBy({ key });
		if (!template?.enabled || !Array.isArray(template.content) || template.content.length < 2) {
			return false;
		}

		try {
			const recipients = this.validateRecipients(to);
			if (recipients.length === 0) {
				return false;
			}

			const referenceEmail = recipients[0];
			const subject = await this.replaceVariables(referenceEmail, template.content[0], context, false);
			const message = await this.replaceVariables(referenceEmail, template.content[1], context, true);
			const sanitizedSubject = sanitizeHtml(subject, this.HTML_SANITIZE_OPTIONS_STRICT);
			const sanitizedMessage = sanitizeHtml(message, this.HTML_SANITIZE_OPTIONS_EMAIL);
			const messageText = this.htmlToPlainText(sanitizedMessage);

			await this.emailService.sendEmailWithBcc(
				sanitizedSubject,
				sanitizedMessage,
				messageText,
				bcc,
				recipients
			);
			return true;
		} catch (error) {
			console.error('Template email sending failed', { key, error: (error as Error).message });
			return false;
		}
	}

	@bindThis
	public async customEmailTemplates(key: string, sub: string, msg: string, enabled: boolean = false): Promise<boolean> {
		if (!this.isValidTemplateKey(key) || !sub.trim() || !msg.trim()) {
			return false;
		}

		if (sub.length > 500 || msg.length > 10000) {
			return false;
		}

		try {
			const existingTemplate = await this.emailTemplatesRepository.findOneBy({ key });
			if (!existingTemplate) {
				return false;
			}

			const template = new MiEmailTemplates();
			template.key = key;
			template.content = [sub.trim(), msg.trim()];
			template.enabled = enabled;

			await this.emailTemplatesRepository.save(template);
			return true;
		} catch (error) {
			console.error('Template save failed', { key, error: (error as Error).message });
			return false;
		}
	}

	@bindThis
	public async getTemplates(key?: string): Promise<MiEmailTemplates | MiEmailTemplates[] | false> {
		if (key) {
			if (!key) return false;
			const result = await this.emailTemplatesRepository.findOneBy({ key });
			return result || false;
		} else {
			try {
				const results = await this.emailTemplatesRepository.find();
				return results || [];
			} catch (error) {
				console.error('Failed to fetch templates', error);
				return [];
			}
		}
	}

	@bindThis
	private async replaceVariables(
		to: string,
		text: string,
		context: TemplateContext = {},
		allowHtml: boolean = false
	): Promise<string> {
		const presetVariables = await this.getPresetVariables(to);
		const allVariables = { ...context, ...presetVariables };

		return this.safeStringReplace(text, allVariables, allowHtml);
	}

	private safeStringReplace(text: string, variables: Record<string, any>, allowHtml: boolean = false): string {
		let result = text;
		let depth = 0;

		while (depth < this.MAX_REPLACEMENT_DEPTH) {
			const originalResult = result;

			result = result.replace(/\$\{([^}]+)\}/g, (match, expression) => {
				const key = expression.trim();

				if (!this.ALLOWED_VARIABLE_PATTERN.test(key)) {
					console.warn('Invalid variable name detected', { key });
					return '';
				}

				if (Object.prototype.hasOwnProperty.call(variables, key)) {
					const value = variables[key];
					return this.sanitizeVariableValue(value, allowHtml);
				}
				return '';
			});

			if (result === originalResult) {
				break;
			}
			depth++;
		}
		return result;
	}

	private async getPresetVariables(to: string): Promise<PresetVariables> {
		const userProfile = await this.userProfilesRepository.findOneBy({ email: to });

		return {
			instanceUrl: this.sanitizeVariableValue(this.config.url, false),
			instanceHost: this.sanitizeVariableValue(this.config.host, false),
			instanceName: this.sanitizeVariableValue(this.meta.name ?? this.config.host, false),
			maintainerName: this.sanitizeVariableValue(this.meta.maintainerName ?? '', false),
			maintainerEmail: this.sanitizeVariableValue(this.meta.maintainerEmail ?? '', false),
			contact: this.sanitizeVariableValue(this.meta.impressumUrl ?? '', false),
			senderEmail: this.sanitizeVariableValue(this.meta.email ?? '', false),
			receiverName: this.sanitizeVariableValue(
				userProfile?.emailVerified ? userProfile.user?.name ?? '' : '', false
			),
			receiverEmail: this.sanitizeVariableValue(to, false),
			iconUrl: this.sanitizeVariableValue(this.meta.logoImageUrl ?? this.meta.iconUrl ?? `${this.config.url}/static-assets/mi-white.png`, false),
			emailSettingUrl: this.sanitizeVariableValue(`${this.config.url}/settings/email`, false),
		};
	}

	private sanitizeVariableValue(value: any, allowHtml: boolean = false): string {
		if (value === null || value === undefined) {
			return '';
		}

		const stringValue = String(value);

		if (allowHtml) {
			return stringValue
				.replace(/javascript:/gi, '')
				.replace(/vbscript:/gi, '')
				.replace(/on\w+\s*=/gi, '')
				.replace(/data:(?!image\/)/gi, 'blocked:')
				.substring(0, 10000);
		} else {
			return stringValue
				.replace(/[<>'"&]/g, '')
				.replace(/javascript:/gi, '')
				.replace(/data:/gi, '')
				.substring(0, 1000);
		}
	}

	private htmlToPlainText(html: string): string {
		const withNewlines = html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<p[^>]*>/gi, '')
			.replace(/<\/div>/gi, '\n')
			.replace(/<div[^>]*>/gi, '');

		const sanitized = sanitizeHtml(withNewlines, {
			allowedTags: [],
			allowedAttributes: {}
		});

		const decoded = decode(sanitized);

		return decoded
			.replace(/\n\s*\n/g, '\n\n')
			.replace(/[ \t]+/g, ' ')
			.trim();
	}

	private isValidTemplateKey(key: string): boolean {
		return key.length > 0 && key.length <= 100 &&
			/^[a-zA-Z0-9_-]+$/.test(key);
	}

	private validateRecipients(to: string | string[]): string[] {
		const recipients: string[] = [];
		const toArray = Array.isArray(to) ? to : [to];

		for (const email of toArray) {
			if (email.trim().length > 0 && email.length <= 254) {
				recipients.push(email.trim());
			}
		}

		if (recipients.length === 0 && this.meta.maintainerEmail && this.meta.maintainerEmail.trim().length > 0) {
			recipients.push(this.meta.maintainerEmail.trim());
		}

		return recipients;
	}
}
