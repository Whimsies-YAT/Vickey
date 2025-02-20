import { Inject, Injectable } from '@nestjs/common';
import { format as dateFormat } from 'date-fns';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { createTemp } from '@/misc/create-temp.js';
import * as XLSX from 'xlsx';
import type { AbuseNoteAutoCheckRepository, MiUser } from '@/models/_.js';
import { DriveService } from '@/core/DriveService.js';
import * as console from "node:console";

export const meta = {
	tags: ['admin', 'abuse-report', 'auto-processed'],
	requireCredential: true,
	requireModerator: true,
	secure: true,
	kind: 'read:admin:abuse-report:auto-processed',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: "object" },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.abuseNoteAutoCheckRepository)
		private abuseNoteAutoCheckRepository: AbuseNoteAutoCheckRepository,

		private driveService: DriveService,
	) {
		super(meta, paramDef, async (ps, me) => {
			let results;
			// eslint-disable-next-line no-useless-catch
			try {
				if (ps.limit) {
					results = await this.abuseNoteAutoCheckRepository.findBy(ps.limit);
				} else {
					results = await this.abuseNoteAutoCheckRepository.find();
				}
			} catch (error) {
				throw error;
			}

			if (!results) return;

			const formattedData = this.formatData(results);

			await this.exportToExcel(formattedData, me);
		});
	}

	formatData(data: any[]) {
		return data.map(item => ({
			id: item.id ?? '',
			detail_id: item.detail.id ?? '',
			detail_note: item.detail.note.text ?? '',
			detail_label: item.detail.label ?? '',
			detail_status: item.detail.status ?? '',
			detail_resolved: item.detail.resolved ? 'Yes' : 'No',
			score: item.score ?? '',
			ignore: item.ignore ? 'Yes' : 'No',
		}));
	}

	async exportToExcel(data: any[], me: MiUser) {
		// eslint-disable-next-line no-useless-catch
		try {
			const [xlsPath, xlsCleanup] = await createTemp();

			const ws = XLSX.utils.json_to_sheet(data);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Abuse Report');

			const fileName = 'abuse-report-processed-' + dateFormat(new Date(), 'yyyy-MM-dd-HH-mm-ss') + '.xlsx';

			XLSX.writeFile(wb, xlsPath);

			const driveFile = await this.driveService.addFile({
				user: me,
				path: xlsPath,
				name: fileName,
				force: true,
			});

			console.log(`Exported to: ${driveFile.id}`);
			xlsCleanup();
		} catch (error) {
			throw error;
		}
	}
}
