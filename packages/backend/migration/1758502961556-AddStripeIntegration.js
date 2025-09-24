/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddStripeIntegration1758502961556 {
	name = 'AddStripeIntegration1758502961556';

	async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "enableStripe" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "stripePublicKey" character varying(1024)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "stripeSecretKey" character varying(1024)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "stripeWebhookSecret" character varying(1024)`);

        await queryRunner.query(`CREATE TABLE "stripe_customer" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"stripeCustomerId" character varying(256) NOT NULL,
			"email" character varying(256),
			"name" character varying(256),
			"metadata" jsonb NOT NULL DEFAULT '{}',
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_stripe_customer_id" PRIMARY KEY ("id")
		)`);

        await queryRunner.query(`CREATE TABLE "stripe_payment" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"stripePaymentIntentId" character varying(256) NOT NULL,
			"stripeCustomerId" character varying(256),
			"amount" integer NOT NULL,
			"currency" character varying(3) NOT NULL,
			"status" character varying NOT NULL CHECK ("status" IN ('requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded')),
			"description" character varying(512),
			"metadata" jsonb NOT NULL DEFAULT '{}',
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_stripe_payment_id" PRIMARY KEY ("id")
		)`);

        await queryRunner.query(`CREATE TABLE "stripe_subscription" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"stripeSubscriptionId" character varying(256) NOT NULL,
			"stripeCustomerId" character varying(256) NOT NULL,
			"stripePriceId" character varying(256) NOT NULL,
			"stripeProductId" character varying(256),
			"status" character varying NOT NULL CHECK ("status" IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
			"currentPeriodStart" TIMESTAMP WITH TIME ZONE NOT NULL,
			"currentPeriodEnd" TIMESTAMP WITH TIME ZONE NOT NULL,
			"cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
			"canceledAt" TIMESTAMP WITH TIME ZONE,
			"endedAt" TIMESTAMP WITH TIME ZONE,
			"trialStart" TIMESTAMP WITH TIME ZONE,
			"trialEnd" TIMESTAMP WITH TIME ZONE,
			"metadata" jsonb NOT NULL DEFAULT '{}',
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_stripe_subscription_id" PRIMARY KEY ("id")
		)`);

        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_customer_userId" ON "stripe_customer" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_stripe_customer_stripeCustomerId" ON "stripe_customer" ("stripeCustomerId")`);

		await queryRunner.query(`CREATE INDEX "IDX_stripe_payment_userId" ON "stripe_payment" ("userId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_payment_stripePaymentIntentId" ON "stripe_payment" ("stripePaymentIntentId")`);

		await queryRunner.query(`CREATE INDEX "IDX_stripe_subscription_userId" ON "stripe_subscription" ("userId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_subscription_stripeSubscriptionId" ON "stripe_subscription" ("stripeSubscriptionId")`);

        await queryRunner.query(`ALTER TABLE "stripe_customer" ADD CONSTRAINT "FK_stripe_customer_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "stripe_payment" ADD CONSTRAINT "FK_stripe_payment_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "stripe_subscription" ADD CONSTRAINT "FK_stripe_subscription_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "paymentReason" character varying(512)`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "isRefunded" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "refundedAmount" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "stripeRiskLevel" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "stripeRiskScore" integer`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" ADD "adminNotes" text`);

        await queryRunner.query(`ALTER TABLE "stripe_subscription" ADD "subscriptionReason" character varying(512)`);
        await queryRunner.query(`ALTER TABLE "stripe_subscription" ADD "adminNotes" text`);

        await queryRunner.query(`CREATE TABLE "stripe_refund" (
            "id" character varying(32) NOT NULL,
            "userId" character varying(32) NOT NULL,
            "stripeRefundId" character varying(256) NOT NULL,
            "stripePaymentId" character varying(32) NOT NULL,
            "stripeChargeId" character varying(256) NOT NULL,
            "amount" integer NOT NULL,
            "currency" character varying(3) NOT NULL,
            "status" character varying NOT NULL CHECK ("status" IN ('pending', 'succeeded', 'failed', 'canceled')),
            "reason" character varying(50),
            "description" character varying(512),
            "adminNotes" text,
            "metadata" jsonb NOT NULL DEFAULT '{}',
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_stripe_refund_id" PRIMARY KEY ("id")
        )`);

        await queryRunner.query(`CREATE INDEX "IDX_stripe_refund_userId" ON "stripe_refund" ("userId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_stripe_refund_stripeRefundId" ON "stripe_refund" ("stripeRefundId")`);
        await queryRunner.query(`CREATE INDEX "IDX_stripe_refund_stripePaymentId" ON "stripe_refund" ("stripePaymentId")`);

        await queryRunner.query(`ALTER TABLE "stripe_refund" ADD CONSTRAINT "FK_stripe_refund_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stripe_refund" ADD CONSTRAINT "FK_stripe_refund_stripePaymentId" FOREIGN KEY ("stripePaymentId") REFERENCES "stripe_payment"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "stripe_refund" DROP CONSTRAINT "FK_stripe_refund_stripePaymentId"`);
        await queryRunner.query(`ALTER TABLE "stripe_refund" DROP CONSTRAINT "FK_stripe_refund_userId"`);
        await queryRunner.query(`DROP INDEX "IDX_stripe_refund_stripePaymentId"`);
        await queryRunner.query(`DROP INDEX "IDX_stripe_refund_stripeRefundId"`);
        await queryRunner.query(`DROP INDEX "IDX_stripe_refund_userId"`);
        await queryRunner.query(`DROP TABLE "stripe_refund"`);

        await queryRunner.query(`ALTER TABLE "stripe_subscription" DROP COLUMN "adminNotes"`);
        await queryRunner.query(`ALTER TABLE "stripe_subscription" DROP COLUMN "subscriptionReason"`);

        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "adminNotes"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "stripeRiskScore"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "stripeRiskLevel"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "refundedAmount"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "isRefunded"`);
        await queryRunner.query(`ALTER TABLE "stripe_payment" DROP COLUMN "paymentReason"`);

        await queryRunner.query(`ALTER TABLE "stripe_subscription" DROP CONSTRAINT "FK_stripe_subscription_userId"`);
		await queryRunner.query(`ALTER TABLE "stripe_payment" DROP CONSTRAINT "FK_stripe_payment_userId"`);
		await queryRunner.query(`ALTER TABLE "stripe_customer" DROP CONSTRAINT "FK_stripe_customer_userId"`);

        await queryRunner.query(`DROP INDEX "IDX_stripe_subscription_stripeSubscriptionId"`);
		await queryRunner.query(`DROP INDEX "IDX_stripe_subscription_userId"`);
		await queryRunner.query(`DROP INDEX "IDX_stripe_payment_stripePaymentIntentId"`);
		await queryRunner.query(`DROP INDEX "IDX_stripe_payment_userId"`);
		await queryRunner.query(`DROP INDEX "IDX_stripe_customer_stripeCustomerId"`);
		await queryRunner.query(`DROP INDEX "IDX_stripe_customer_userId"`);

        await queryRunner.query(`DROP TABLE "stripe_subscription"`);
		await queryRunner.query(`DROP TABLE "stripe_payment"`);
		await queryRunner.query(`DROP TABLE "stripe_customer"`);

        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "stripeWebhookSecret"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "stripeSecretKey"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "stripePublicKey"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableStripe"`);
	}
}
