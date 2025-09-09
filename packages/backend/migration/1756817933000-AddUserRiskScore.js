/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserRiskScore1756817933000 {
	name = 'AddUserRiskScore1756817933000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" ADD "riskScore" real`);
		await queryRunner.query(`ALTER TABLE "user" ADD "riskLevel" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "user" ADD "riskScoreUpdatedAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE INDEX "IDX_user_riskScore" ON "user" ("riskScore")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_riskLevel" ON "user" ("riskLevel")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_riskScoreUpdatedAt" ON "user" ("riskScoreUpdatedAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_risk_composite" ON "user" ("host", "riskLevel", "riskScore") WHERE "host" IS NULL`);
		await queryRunner.query(`
			CREATE TABLE "account_link" (
				"id" character varying(32) NOT NULL,
				"primaryUserId" character varying(32) NOT NULL,
				"linkedUserId" character varying(32) NOT NULL,
				"confidence" real NOT NULL DEFAULT 0,
				"detectionMethods" jsonb NOT NULL DEFAULT '[]',
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"expiresAt" TIMESTAMP WITH TIME ZONE,
				"penaltyMultiplier" real NOT NULL DEFAULT 1.5,
				"isManual" boolean NOT NULL DEFAULT false,
				"metadata" jsonb NOT NULL DEFAULT '{}',
				CONSTRAINT "PK_account_link" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_account_link_primaryUserId" ON "account_link" ("primaryUserId")`);
		await queryRunner.query(`CREATE INDEX "IDX_account_link_linkedUserId" ON "account_link" ("linkedUserId")`);
		await queryRunner.query(`CREATE INDEX "IDX_account_link_expiresAt" ON "account_link" ("expiresAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_account_link_isManual" ON "account_link" ("isManual")`);
		await queryRunner.query(`ALTER TABLE "account_link" ADD CONSTRAINT "FK_account_link_primaryUserId" FOREIGN KEY ("primaryUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "account_link" ADD CONSTRAINT "FK_account_link_linkedUserId" FOREIGN KEY ("linkedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`
			CREATE TABLE "risk_score_history" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"score" real NOT NULL,
				"level" character varying(32) NOT NULL,
				"dimensions" jsonb NOT NULL,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_risk_score_history" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_risk_score_history_userId" ON "risk_score_history" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_risk_score_history_createdAt" ON "risk_score_history" ("createdAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_risk_score_history_userId_createdAt" ON "risk_score_history" ("userId", "createdAt" DESC)`);
		await queryRunner.query(`ALTER TABLE "risk_score_history" ADD CONSTRAINT "FK_risk_score_history_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`
			UPDATE "user"
			SET "riskScore" = 60,
			    "riskLevel" = 'fair',
			    "riskScoreUpdatedAt" = now()
			WHERE "host" IS NULL
		`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "risk_score_history" DROP CONSTRAINT "FK_risk_score_history_userId"`);
		await queryRunner.query(`ALTER TABLE "account_link" DROP CONSTRAINT "FK_account_link_linkedUserId"`);
		await queryRunner.query(`ALTER TABLE "account_link" DROP CONSTRAINT "FK_account_link_primaryUserId"`);
		await queryRunner.query(`DROP TABLE "risk_score_history"`);
		await queryRunner.query(`DROP TABLE "account_link"`);
		await queryRunner.query(`DROP INDEX "IDX_user_risk_composite"`);
		await queryRunner.query(`DROP INDEX "IDX_user_riskScoreUpdatedAt"`);
		await queryRunner.query(`DROP INDEX "IDX_user_riskLevel"`);
		await queryRunner.query(`DROP INDEX "IDX_user_riskScore"`);
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "riskScoreUpdatedAt"`);
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "riskLevel"`);
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "riskScore"`);
	}
}
