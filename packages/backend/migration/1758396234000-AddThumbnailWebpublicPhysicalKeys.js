/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddThumbnailWebpublicPhysicalKeys1758396234000 {
    name = 'AddThumbnailWebpublicPhysicalKeys1758396234000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "thumbnailPhysicalKey" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "webpublicPhysicalKey" varchar(256)`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_thumbnail_physical_key" ON "drive_file" ("thumbnailPhysicalKey") WHERE "thumbnailPhysicalKey" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_drive_file_webpublic_physical_key" ON "drive_file" ("webpublicPhysicalKey") WHERE "webpublicPhysicalKey" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_webpublic_physical_key"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drive_file_thumbnail_physical_key"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "webpublicPhysicalKey"`);
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "thumbnailPhysicalKey"`);
    }
}