/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddPdqHash1758294360000 {
    name = 'AddPdqHash1758294360000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "pdqHash" varchar(64)`);
        await queryRunner.query(`COMMENT ON COLUMN "drive_file"."pdqHash" IS 'The PDQ hash of the DriveFile for image similarity detection.'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "pdqHash"`);
    }
}
