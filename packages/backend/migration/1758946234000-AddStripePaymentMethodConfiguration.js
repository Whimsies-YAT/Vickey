/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddStripePaymentMethodConfiguration1758946234000 {
    constructor() {
        this.name = 'AddStripePaymentMethodConfiguration1758946234000';
    }

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "stripePaymentMethodConfiguration" character varying(1024)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "stripePaymentMethodConfiguration"`);
    }
}