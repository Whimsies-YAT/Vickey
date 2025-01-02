/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class SupportBanArea1735560438000 {
    name = 'SupportBanArea1735560438000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "ip2lAuthKey" character varying(128)`);
			  await queryRunner.query(`ALTER TABLE "meta" ADD "ip2lIsPro" boolean NOT NULL DEFAULT false`);
			  await queryRunner.query(`ALTER TABLE "meta" ADD "banCountry" text[] NOT NULL DEFAULT '{}'`);
			  await queryRunner.query(`ALTER TABLE "meta" ADD "exemptIP" text[] NOT NULL DEFAULT '{}'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "ip2lAuthKey"`);
			  await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "ip2lIsPro"`);
			  await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "banCountry"`);
			  await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "exemptIP"`);
    }
}
