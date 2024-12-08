/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class EnhanceApprove1733627870000 {
    name = 'EnhanceApprove1733627870000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_pending" ADD "emailVerified" boolean NOT NULL DEFAULT false`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "emailVerified"`);
    }
}
