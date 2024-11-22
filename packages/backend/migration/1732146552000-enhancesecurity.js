/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class EnhanceSecurity1732146552000 {
    name = 'EnhanceSecurity1732146552000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "security" boolean NOT NULL DEFAULT true`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "security"`);
    }
}
