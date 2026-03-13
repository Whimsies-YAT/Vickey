/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URLSearchParams } from 'node:url';
import * as nodemailer from 'nodemailer';
import juice from 'juice';
import { Inject, Injectable } from '@nestjs/common';
import { validate as validateEmail } from 'deep-email-validator';
import { UtilityService } from '@/core/UtilityService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import type { MiMeta, UserProfilesRepository } from '@/models/_.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';

@Injectable()
export class EmailService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private loggerService: LoggerService,
		private utilityService: UtilityService,
		private httpRequestService: HttpRequestService,
	) {
		this.logger = this.loggerService.getLogger('email');
	}

	@bindThis
	public async sendEmailWithBcc(subject: string, html: string, text: string, bcc: boolean = false, to: string | string[], htmlTemplate?: string) {
		if (!this.meta.enableEmail) return;

		let emails: string[] = [];

		if (Array.isArray(to)) {
			emails = to.filter(e => !!e && e.trim() !== '').map(e => e.trim());
		} else if (to.trim() !== '') {
			emails = [to.trim()];
		}

		if (emails.length === 0) return;

		const primaryRecipient =
			this.meta.visibleRecipient && this.meta.visibleRecipient.trim() !== ""
				? this.meta.visibleRecipient.trim()
				: this.meta.maintainerEmail?.trim();
		if (!primaryRecipient) return;

		if (bcc) {
			if (this.meta.enableBcc) {
				const limit = Number(this.meta.bccLimit);
				if (limit >= 1 && limit <= 20) {
					while (emails.length) {
						const batch = emails.splice(0, limit);
						await this.sendEmail(primaryRecipient, subject, html, text, batch);
					}
					return;
				}
				this.logger.error('Exceeding the limit');
				return;
			}
		} else {
			for (const email of emails) {
				await this.sendEmail(email, subject, html, text, htmlTemplate);
			}
			return;
		}
	}

	@bindThis
	public async sendEmail(to: string, subject: string, html: string, text: string, bcc?: string | string[], htmlTemplate?: string) {
		if (!this.meta.enableEmail) return;

		const iconUrl = `${this.config.url}/static-assets/mi-white.png`;
		const emailSettingUrl = `${this.config.url}/settings/email`;

		const enableAuth = this.meta.smtpUser != null && this.meta.smtpUser !== '';

		const transporter = nodemailer.createTransport({
			host: this.meta.smtpHost,
			port: this.meta.smtpPort,
			secure: this.meta.smtpSecure,
			ignoreTLS: !enableAuth,
			proxy: this.config.proxySmtp,
			auth: enableAuth ? {
				user: this.meta.smtpUser,
				pass: this.meta.smtpPass,
			} : undefined,
		} as any);

		let htmlContent: string;

		if (!htmlTemplate) {
			htmlContent = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${ subject }</title>
    <style>
      body, table, td, p, a, li, blockquote {
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }
      table, td {
        mso-table-lspace: 0pt;
        mso-table-rspace: 0pt;
      }
      img {
        -ms-interpolation-mode: bicubic;
        border: 0;
        height: auto;
        line-height: 100%;
        outline: none;
        text-decoration: none;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: linear-gradient(135deg, #0d1421 0%, #1a1b3d 50%, #2a1b4d 100%);
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
        min-height: 100vh;
      }
      table {
        border-collapse: collapse !important;
      }
      .email-container {
        max-width: 580px;
        margin: 0 auto;
        background: linear-gradient(135deg, #1e2a5a 0%, #2d1b69 100%);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(20px);
      }
      .header-cell {
        background: linear-gradient(135deg, #1a237e 0%, #3f51b5 30%, #673ab7 70%, #9c27b0 100%);
        position: relative;
        padding: 40px;
        text-align: center;
      }
      .header-cell::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(ellipse at center top, rgba(255,255,255,0.1) 0%, transparent 70%);
        pointer-events: none;
      }
      .logo-img {
        max-height: 56px;
        width: auto;
        display: block;
        margin: 0 auto;
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
        position: relative;
        z-index: 1;
      }
      .content-cell {
        padding: 40px;
        background: linear-gradient(135deg, #1e2a5a 0%, #2d1b69 100%);
        position: relative;
      }
      .content-cell::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent 0%, rgba(147, 112, 219, 0.3) 50%, transparent 100%);
      }
      .content-title {
        margin: 0 0 24px 0;
        font-size: 28px;
        font-weight: 600;
        color: #f5f7ff;
        line-height: 1.2;
        text-shadow: 0 2px 8px rgba(0,0,0,0.3);
        letter-spacing: -0.5px;
      }
      .content-text {
        margin: 0;
        font-size: 16px;
        line-height: 1.7;
        color: #e1e7f5;
        font-weight: 400;
      }
      .content-text p {
        margin: 0 0 18px 0;
      }
      .content-text a {
        color: #7c4dff;
        text-decoration: none;
        font-weight: 500;
        border-bottom: 1px solid rgba(124, 77, 255, 0.3);
        transition: all 0.3s ease;
      }
      .content-text a:hover {
        color: #b388ff;
        border-bottom-color: #b388ff;
      }
      .footer-cell {
        padding: 36px 40px;
        background: linear-gradient(135deg, #151f4a 0%, #1a1b3d 100%);
        text-align: center;
        border-top: 1px solid rgba(147, 112, 219, 0.2);
        position: relative;
      }
      .footer-button {
        display: inline-block;
        padding: 16px 32px;
        background: linear-gradient(135deg, #673ab7 0%, #9c27b0 100%);
        color: #ffffff !important;
        text-decoration: none;
        font-weight: 600;
        font-size: 15px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(103, 58, 183, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
        letter-spacing: 0.5px;
      }
      .footer-button:hover {
        background: linear-gradient(135deg, #7c4dff 0%, #b388ff 100%);
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(124, 77, 255, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.2);
      }
      .nav-cell {
        padding: 20px 40px;
        text-align: center;
        background-color: transparent;
      }
      .nav-link {
        color: #b8c5d6;
        font-size: 14px;
        text-decoration: none;
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(10px);
        padding: 12px 24px;
        border-radius: 24px;
        display: inline-block;
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.3s ease;
        font-weight: 500;
      }
      .nav-link:hover {
        background: rgba(147, 112, 219, 0.15);
        border-color: rgba(147, 112, 219, 0.3);
        color: #d4e2f2;
        transform: translateY(-1px);
      }
      .decorative-accent {
        position: absolute;
        top: -2px;
        left: 50%;
        transform: translateX(-50%);
        width: 80px;
        height: 4px;
        background: linear-gradient(90deg, #7c4dff 0%, #b388ff 50%, #ce93d8 100%);
        border-radius: 2px;
      }
      @media screen and (max-width: 640px) {
        .email-container {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 16px;
          border-radius: 12px;
        }
        .header-cell,
        .content-cell,
        .footer-cell,
        .nav-cell {
          padding-left: 24px !important;
          padding-right: 24px !important;
        }
        .header-cell {
          padding-top: 32px !important;
          padding-bottom: 32px !important;
        }
        .content-cell {
          padding-top: 32px !important;
          padding-bottom: 32px !important;
        }
        .content-title {
          font-size: 24px !important;
        }
        .content-text {
          font-size: 15px !important;
        }
      }
      /*[if mso]>
      <style type="text/css">
        .header-cell {
          background-color: #3f51b5 !important;
        }
        .content-cell {
          background-color: #1e2a5a !important;
        }
        .footer-cell {
          background-color: #151f4a !important;
        }
        .footer-button {
          border: none !important;
          background-color: #673ab7 !important;
        }
      </style>
      <![endif]-->
    </style>
  </head>
  <body style="margin: 0; padding: 0; background: linear-gradient(135deg, #0d1421 0%, #1a1b3d 50%, #2a1b4d 100%); min-height: 100vh;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(135deg, #0d1421 0%, #1a1b3d 50%, #2a1b4d 100%); min-height: 100vh;">
      <tr>
        <td style="padding: 32px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="580" class="email-container" style="margin: 0 auto;">
            <tr>
              <td class="header-cell" style="position: relative;">
                <div class="decorative-accent"></div>
                <img src="${ this.meta.logoImageUrl ?? this.meta.iconUrl ?? iconUrl }" alt="Logo" class="logo-img" style="max-width: 140px; height: auto; display: block; margin: 0 auto; position: relative; z-index: 1;">
              </td>
            </tr>
            <tr>
              <td class="content-cell">
                <h1 class="content-title">${ subject }</h1>
                <div class="content-text">
                  ${ html }
                </div>
              </td>
            </tr>
            <tr>
              <td class="footer-cell">
                <a href="${ emailSettingUrl }" class="footer-button">${ 'Email setting' }</a>
              </td>
            </tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="580" style="margin: 20px auto 0 auto;">
            <tr>
              <td class="nav-cell">
                <a href="${ this.config.url }" class="nav-link">${ this.config.host }</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
		} else {
			htmlContent = htmlTemplate;
		}

		const inlinedHtml = juice(htmlContent);

		try {
			// TODO: htmlサニタイズ
			const mailOptions: any = {
				from: this.meta.name ? {
					name: this.meta.name,
					address: this.meta.email!,
				} : this.meta.email!,
				to: to,
				subject: subject,
				text: text,
				html: inlinedHtml,
			};

			if (bcc) {
				mailOptions.bcc = bcc;
			}

			const info = await transporter.sendMail(mailOptions);
			this.logger.info(`Message sent: ${info.messageId}`);
		} catch (err) {
			this.logger.error(err as Error);
			throw err;
		}
	}

	@bindThis
	public async validateEmailForAccount(emailAddress: string): Promise<{
		available: boolean;
		reason: null | 'used' | 'format' | 'disposable' | 'mx' | 'smtp' | 'banned' | 'network' | 'blacklist';
	}> {
		if (!this.utilityService.validateEmailFormat(emailAddress)) {
			return {
				available: false,
				reason: 'format',
			};
		}

		const exist = await this.userProfilesRepository.countBy({
			emailVerified: true,
			email: emailAddress,
		});

		if (exist !== 0) {
			return {
				available: false,
				reason: 'used',
			};
		}

		let validated: {
			valid: boolean,
			reason?: string | null,
		} = { valid: true, reason: null };

		if (this.meta.enableActiveEmailValidation) {
			if (this.meta.enableVerifymailApi && this.meta.verifymailAuthKey != null) {
				validated = await this.verifyMail(emailAddress, this.meta.verifymailAuthKey);
			} else if (this.meta.enableTruemailApi && this.meta.truemailInstance && this.meta.truemailAuthKey != null) {
				validated = await this.trueMail(this.meta.truemailInstance, emailAddress, this.meta.truemailAuthKey);
			} else {
				validated = await validateEmail({
					email: emailAddress,
					validateRegex: true,
					validateMx: true,
					validateTypo: false, // TLDを見ているみたいだけどclubとか弾かれるので
					validateDisposable: true, // 捨てアドかどうかチェック
					validateSMTP: false, // 日本だと25ポートが殆どのプロバイダーで塞がれていてタイムアウトになるので
				});
			}
		}

		if (!validated.valid) {
			const formatReason: Record<string, 'format' | 'disposable' | 'mx' | 'smtp' | 'network' | 'blacklist' | undefined> = {
				regex: 'format',
				disposable: 'disposable',
				mx: 'mx',
				smtp: 'smtp',
				network: 'network',
				blacklist: 'blacklist',
			};

			return {
				available: false,
				reason: validated.reason ? formatReason[validated.reason] ?? null : null,
			};
		}

		const emailDomain: string = emailAddress.split('@')[1];
		const isBanned = this.utilityService.isBlockedHost(this.meta.bannedEmailDomains, emailDomain);

		if (isBanned) {
			return {
				available: false,
				reason: 'banned',
			};
		}

		return {
			available: true,
			reason: null,
		};
	}

	private async verifyMail(emailAddress: string, verifymailAuthKey: string): Promise<{
		valid: boolean;
		reason: 'used' | 'format' | 'disposable' | 'mx' | 'smtp' | null;
	}> {
		const endpoint = 'https://verifymail.io/api/' + emailAddress + '?key=' + verifymailAuthKey;
		const res = await this.httpRequestService.send(endpoint, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json, */*',
			},
		});

		const json = (await res.json()) as Partial<{
			message: string;
			block: boolean;
			catch_all: boolean;
			deliverable_email: boolean;
			disposable: boolean;
			domain: string;
			email_address: string;
			email_provider: string;
			mx: boolean;
			mx_fallback: boolean;
			mx_host: string[];
			mx_ip: string[];
			mx_priority: { [key: string]: number };
			privacy: boolean;
			related_domains: string[];
		}>;

		/* api error: when there is only one `message` attribute in the returned result */
		if (Object.keys(json).length === 1 && Reflect.has(json, 'message')) {
			return {
				valid: false,
				reason: null,
			};
		}
		if (json.email_address === undefined) {
			return {
				valid: false,
				reason: 'format',
			};
		}
		if (json.deliverable_email !== undefined && !json.deliverable_email) {
			return {
				valid: false,
				reason: 'smtp',
			};
		}
		if (json.disposable) {
			return {
				valid: false,
				reason: 'disposable',
			};
		}
		if (json.mx !== undefined && !json.mx) {
			return {
				valid: false,
				reason: 'mx',
			};
		}

		return {
			valid: true,
			reason: null,
		};
	}

	private async trueMail<T>(truemailInstance: string, emailAddress: string, truemailAuthKey: string): Promise<{
		valid: boolean;
		reason: 'used' | 'format' | 'blacklist' | 'mx' | 'smtp' | 'network' | T | null;
	}> {
		const endpoint = truemailInstance + '?email=' + emailAddress;
		try {
			const res = await this.httpRequestService.send(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					Authorization: truemailAuthKey,
				},
				isLocalAddressAllowed: true,
			});

			const json = (await res.json()) as {
				email: string;
				success: boolean;
				error?: string;
				errors?: {
					list_match?: string;
					regex?: string;
					mx?: string;
					smtp?: string;
				} | null;
			};

			if (json.email === undefined || json.errors?.regex) {
				return {
					valid: false,
					reason: 'format',
				};
			}
			if (json.errors?.smtp) {
				return {
					valid: false,
					reason: 'smtp',
				};
			}
			if (json.errors?.mx) {
				return {
					valid: false,
					reason: 'mx',
				};
			}
			if (!json.success) {
				return {
					valid: false,
					reason: json.errors?.list_match as T || 'blacklist',
				};
			}

			return {
				valid: true,
				reason: null,
			};
		} catch (_) {
			return {
				valid: false,
				reason: 'network',
			};
		}
	}
}
