/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddPdqVector1758378610000 {
    name = 'AddPdqVector1758378610000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "pdqVector" vector(256)`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_pdq_hash" ON "drive_file" ("pdqHash") WHERE "pdqHash" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_pdq_vector" ON "drive_file" USING ivfflat ("pdqVector" vector_cosine_ops) WHERE "pdqVector" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_pdq_vector"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_pdq_hash"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "pdqVector"`);
    }
}