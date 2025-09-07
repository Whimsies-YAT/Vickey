/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserRiskScoreHistory1756817971001 {
    name = 'AddUserRiskScoreHistory1756817971001'

    async up(queryRunner) {
        await queryRunner.query(`
            CREATE TABLE "user_risk_score_history" (
                "id" character varying(32) NOT NULL,
                "userId" character varying(32) NOT NULL,
                "totalScore" real NOT NULL DEFAULT 50,
                "riskLevel" character varying(32) NOT NULL DEFAULT 'medium',
                "profileScore" real NOT NULL DEFAULT 0,
                "activityScore" real NOT NULL DEFAULT 0,
                "relationshipScore" real NOT NULL DEFAULT 0,
                "contentScore" real NOT NULL DEFAULT 0,
                "engagementScore" real NOT NULL DEFAULT 0,
                "multiAccountScore" real NOT NULL DEFAULT 0,
                "calculatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_user_risk_score_history" PRIMARY KEY ("id")
            )`);

        await queryRunner.query(`CREATE INDEX "IDX_user_risk_score_history_userId" ON "user_risk_score_history" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_user_risk_score_history_calculatedAt" ON "user_risk_score_history" ("calculatedAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_user_risk_score_history_riskLevel" ON "user_risk_score_history" ("riskLevel")`);

        await queryRunner.query(`
            CREATE TABLE "risk_event_log" (
                "id" character varying(32) NOT NULL,
                "userId" character varying(32) NOT NULL,
                "eventType" character varying(64) NOT NULL,
                "riskScore" real NOT NULL,
                "riskLevel" character varying(32) NOT NULL,
                "details" jsonb NOT NULL DEFAULT '{}',
                "ip" character varying(128),
                "userAgent" text,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_risk_event_log" PRIMARY KEY ("id")
            )`);

        await queryRunner.query(`CREATE INDEX "IDX_risk_event_log_userId" ON "risk_event_log" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_risk_event_log_eventType" ON "risk_event_log" ("eventType")`);
        await queryRunner.query(`CREATE INDEX "IDX_risk_event_log_createdAt" ON "risk_event_log" ("createdAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_risk_event_log_riskLevel" ON "risk_event_log" ("riskLevel")`);

        await queryRunner.query(`
            CREATE TABLE "user_multi_account_link" (
                "id" character varying(32) NOT NULL,
                "userId" character varying(32) NOT NULL,
                "linkedUserId" character varying(32) NOT NULL,
                "linkType" character varying(32) NOT NULL,
                "confidence" real NOT NULL DEFAULT 0.5,
                "evidence" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_user_multi_account_link" PRIMARY KEY ("id")
            )`);

        await queryRunner.query(`CREATE INDEX "IDX_user_multi_account_link_userId" ON "user_multi_account_link" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_user_multi_account_link_linkedUserId" ON "user_multi_account_link" ("linkedUserId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_multi_account_link_unique" ON "user_multi_account_link" ("userId", "linkedUserId")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_user_multi_account_link_unique"`);
        await queryRunner.query(`DROP INDEX "IDX_user_multi_account_link_linkedUserId"`);
        await queryRunner.query(`DROP INDEX "IDX_user_multi_account_link_userId"`);
        await queryRunner.query(`DROP TABLE "user_multi_account_link"`);

        await queryRunner.query(`DROP INDEX "IDX_risk_event_log_riskLevel"`);
        await queryRunner.query(`DROP INDEX "IDX_risk_event_log_createdAt"`);
        await queryRunner.query(`DROP INDEX "IDX_risk_event_log_eventType"`);
        await queryRunner.query(`DROP INDEX "IDX_risk_event_log_userId"`);
        await queryRunner.query(`DROP TABLE "risk_event_log"`);

        await queryRunner.query(`DROP INDEX "IDX_user_risk_score_history_riskLevel"`);
        await queryRunner.query(`DROP INDEX "IDX_user_risk_score_history_calculatedAt"`);
        await queryRunner.query(`DROP INDEX "IDX_user_risk_score_history_userId"`);
        await queryRunner.query(`DROP TABLE "user_risk_score_history"`);
    }
}
