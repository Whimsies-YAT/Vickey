/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddIpToUserSessions1756609728000 {
    name = 'AddIpToUserSessions1756609728000'

    async up(queryRunner) {
        await queryRunner.query(`
            ALTER TABLE "user_sessions" ADD COLUMN "ip" JSONB
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`
            ALTER TABLE "user_sessions" DROP COLUMN "ip"
        `);
    }
}