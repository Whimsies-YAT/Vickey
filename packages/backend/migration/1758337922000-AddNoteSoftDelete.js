/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddNoteSoftDelete1758337922000 {
	name = 'AddNoteSoftDelete1758337922000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" ADD "isDeleted" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE INDEX "IDX_NOTE_IS_DELETED" ON "note" ("isDeleted")`);
		await queryRunner.query(`CREATE INDEX "IDX_NOTE_USER_IS_DELETED" ON "note" ("userId", "isDeleted", "id" DESC)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_NOTE_USER_IS_DELETED"`);
		await queryRunner.query(`DROP INDEX "IDX_NOTE_IS_DELETED"`);
		await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "isDeleted"`);
	}
}
