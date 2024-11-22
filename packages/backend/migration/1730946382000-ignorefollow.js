/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class FollowRequestIgnore1730946382000 {
    name = 'FollowRequestIgnore1730946382000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "follow_request" ADD "ignore" boolean NOT NULL DEFAULT false`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "follow_request" DROP COLUMN "ignore"`);
    }
}