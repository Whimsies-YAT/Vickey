/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class OptimizeDeletedNotesQuery1763301400734 {
	name = 'OptimizeDeletedNotesQuery1763301400734'

	async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX "IDX_note_isDeleted_id_partial" ON "note" ("id" DESC) WHERE "isDeleted" = true`);
		await queryRunner.query(`CREATE INDEX "IDX_note_isDeleted_userId_partial" ON "note" ("userId", "id" DESC) WHERE "isDeleted" = true`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_note_isDeleted_userId_partial"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_note_isDeleted_id_partial"`);
	}
}