/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class enhanceApproval1742032616000 {
    name = 'enhanceApproval1742032616000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_pending" ADD "result" character varying(1024)`);
				await queryRunner.query(`ALTER TABLE "user_pending" ADD "isProcessed" boolean NOT NULL DEFAULT false`);
				await queryRunner.query(`ALTER TABLE "user_pending" ADD "time" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }

    async down(queryRunner) {
				await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "time"`);
        await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "isProcessed"`);
				await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "result"`);
    }
}
