/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddReindexLockFields1760424406000 {
	name = 'AddReindexLockFields1760424406000'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "elasticsearch_reindex_state" ADD "lockedBy" character varying(128)`);
		await queryRunner.query(`ALTER TABLE "elasticsearch_reindex_state" ADD "lockedAt" TIMESTAMP WITH TIME ZONE`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "elasticsearch_reindex_state" DROP COLUMN "lockedAt"`);
		await queryRunner.query(`ALTER TABLE "elasticsearch_reindex_state" DROP COLUMN "lockedBy"`);
	}
}