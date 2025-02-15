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
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { MiMeta } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import { DI } from "@/di-symbols.js";

@Injectable()
export class MLReportService {
	private logger: Logger;
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private emailService: EmailService,
		private emailTemplatesService: EmailTemplatesService,
		private metaService: MetaService,
		private httpRequestService: HttpRequestService,
		private internalStorageService: InternalStorageService
	) {}

	@bindThis
	public async MLCheck(model: string): Promise<void> {

	}
}
