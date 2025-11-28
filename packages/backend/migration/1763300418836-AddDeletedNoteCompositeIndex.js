/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddDeletedNoteCompositeIndex1763300418836 {
	name = 'AddDeletedNoteCompositeIndex1763300418836'

	async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX "IDX_note_isDeleted_deletedAt" ON "note" ("isDeleted", "deletedAt") WHERE "isDeleted" = true`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_note_isDeleted_deletedAt"`);
	}
}