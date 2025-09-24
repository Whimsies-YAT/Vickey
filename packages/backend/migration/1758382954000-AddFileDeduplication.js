/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddFileDeduplication1758382954000 {
    name = 'AddFileDeduplication1758382954000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "sha256" varchar(64)`);
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "fingerprint" varchar(144)`);
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "physicalKey" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "refCount" integer NOT NULL DEFAULT 1`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_fingerprint" ON "drive_file" ("fingerprint") WHERE "fingerprint" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_physical_key" ON "drive_file" ("physicalKey") WHERE "physicalKey" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_sha256" ON "drive_file" ("sha256") WHERE "sha256" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_sha256"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_physical_key"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_fingerprint"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "refCount"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "physicalKey"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "fingerprint"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "sha256"`);
    }
}