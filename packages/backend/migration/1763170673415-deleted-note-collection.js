/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class DeletedNoteCollection1763170673415 {
	name = 'DeletedNoteCollection1763170673415'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "deletedNoteCollectionInstances" character varying(1024) array NOT NULL DEFAULT '{local}'`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "deletedNoteRetentionHours" integer NOT NULL DEFAULT 48`);
		await queryRunner.query(`ALTER TABLE "note" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE INDEX "IDX_note_deletedAt" ON "note" ("deletedAt") `);
		await queryRunner.query(`DELETE FROM "note" WHERE "isDeleted" = true AND "deletedAt" IS NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_note_deletedAt"`);
		await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "deletedAt"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "deletedNoteRetentionHours"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "deletedNoteCollectionInstances"`);
	}
}
