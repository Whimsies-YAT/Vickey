/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddCheckoutSessionSupport1758857955000 {
    constructor() {
        this.name = 'AddCheckoutSessionSupport1758857955000';
    }

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_stripe_payment_stripePaymentIntentId"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ALTER COLUMN "stripePaymentIntentId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "stripeCheckoutSessionId" character varying(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_payment_stripePaymentIntentId" ON "stripe_payment" ("stripePaymentIntentId") WHERE "stripePaymentIntentId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_payment_stripeCheckoutSessionId" ON "stripe_payment" ("stripeCheckoutSessionId") WHERE "stripeCheckoutSessionId" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_stripe_payment_stripeCheckoutSessionId"`);
        await queryRunner.query(`DROP INDEX "IDX_stripe_payment_stripePaymentIntentId"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "stripeCheckoutSessionId"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ALTER COLUMN "stripePaymentIntentId" SET NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_payment_stripePaymentIntentId" ON "stripe_payment" ("stripePaymentIntentId")`);
    }
}
