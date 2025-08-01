/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class Bcc1753958521802 {
    name = 'Bcc1753958521802'

    async up(queryRunner) {
			await queryRunner.query(`ALTER TABLE "meta" ADD "enableBcc" boolean NOT NULL DEFAULT false`);
            await queryRunner.query(`ALTER TABLE "meta" ADD "bccLimit" int NOT NULL DEFAULT 20`);
            await queryRunner.query(`ALTER TABLE "meta" ADD "visibleRecipient" character varying(256)`);
    }

    async down(queryRunner) {
            await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "visibleRecipient"`);
            await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "bccLimit"`);
			await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableBcc"`);
    }
}
