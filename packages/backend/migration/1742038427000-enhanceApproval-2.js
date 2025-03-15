/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class enhanceApproval1742038427000 {
    name = 'enhanceApproval1742038427000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_pending" ADD "ip" character varying(256)`);
				await queryRunner.query(`ALTER TABLE "user_pending" ALTER COLUMN "code" TYPE character varying(256)`);
    }

    async down(queryRunner) {
				await queryRunner.query(`ALTER TABLE "user_pending" ALTER COLUMN "code" TYPE character varying(128)`);
				await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "ip"`);
    }
}
