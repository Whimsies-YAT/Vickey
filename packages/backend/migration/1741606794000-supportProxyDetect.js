/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class SupportProxyDetect1741606794000 {
    name = 'SupportProxyDetect1741606794000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "ip2lProxyAuthKey" character varying(128)`);
			  await queryRunner.query(`ALTER TABLE "meta" ADD "ip2lProxyIsPro" boolean NOT NULL DEFAULT false`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "ip2lProxyAuthKey"`);
			  await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "ip2lProxyIsPro"`);
    }
}
