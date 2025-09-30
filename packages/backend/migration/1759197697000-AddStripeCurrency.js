/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddStripeCurrency1759197697000 {
    constructor() {
        this.name = 'AddStripeCurrency1759197697000';
    }

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "stripeCurrency" character varying(3) NOT NULL DEFAULT 'USD'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "stripeCurrency"`);
    }
}