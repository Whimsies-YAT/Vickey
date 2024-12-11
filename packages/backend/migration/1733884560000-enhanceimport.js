/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class EnhanceImport1733884560000 {
    name = 'EnhanceImport1733884560000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "avatar_decoration" ADD "driveId" character varying(32) DEFAULT NULL`);
			  await queryRunner.query(`ALTER TABLE "emoji" ADD "driveId" character varying(32) DEFAULT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "avatar_decoration" DROP COLUMN "driveId"`);
			  await queryRunner.query(`ALTER TABLE "emoji" DROP COLUMN "driveId"`);
    }
}
