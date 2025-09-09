/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddRecommendationTables17570879630000 {
	name = 'AddRecommendationTables1757087963000'

	async up(queryRunner) {
		await queryRunner.query(`
			CREATE TABLE "user_recommendation_profile" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"interestCategories" jsonb NOT NULL DEFAULT '{}',
				"contentTypePreferences" jsonb NOT NULL DEFAULT '{}',
				"languagePreferences" jsonb NOT NULL DEFAULT '{}',
				"topicPreferences" jsonb NOT NULL DEFAULT '{}',
				"interactionPatterns" jsonb NOT NULL DEFAULT '{}',
				"socialPreferences" jsonb NOT NULL DEFAULT '{}',
				"explorationFactor" real NOT NULL DEFAULT 0.5,
				"recencyWeight" real NOT NULL DEFAULT 0.7,
				"qualityThreshold" real NOT NULL DEFAULT 0.6,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"lastLearningUpdate" TIMESTAMP WITH TIME ZONE,
				"learningDataPoints" integer NOT NULL DEFAULT 0,
				"confidenceScore" real NOT NULL DEFAULT 0.5,
				CONSTRAINT "PK_user_recommendation_profile" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_user_recommendation_profile_userId" UNIQUE ("userId")
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_user_recommendation_profile_userId" ON "user_recommendation_profile" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_recommendation_profile_lastLearningUpdate" ON "user_recommendation_profile" ("lastLearningUpdate")`);
		await queryRunner.query(`
			CREATE TABLE "content_recommendation_log" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"noteId" character varying(32) NOT NULL,
				"algorithm" character varying(64) NOT NULL,
				"score" real NOT NULL,
				"position" integer NOT NULL,
				"context" character varying(32) NOT NULL,
				"factors" jsonb NOT NULL DEFAULT '{}',
				"viewed" boolean NOT NULL DEFAULT false,
				"engaged" boolean NOT NULL DEFAULT false,
				"engagementType" character varying(32),
				"viewDuration" integer,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"viewedAt" TIMESTAMP WITH TIME ZONE,
				"engagedAt" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "PK_content_recommendation_log" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_content_recommendation_log_userId" ON "content_recommendation_log" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_content_recommendation_log_noteId" ON "content_recommendation_log" ("noteId")`);
		await queryRunner.query(`CREATE INDEX "IDX_content_recommendation_log_createdAt" ON "content_recommendation_log" ("createdAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_content_recommendation_log_context" ON "content_recommendation_log" ("context")`);
		await queryRunner.query(`CREATE INDEX "IDX_content_recommendation_log_engaged" ON "content_recommendation_log" ("engaged")`);
		await queryRunner.query(`
			CREATE TABLE "user_interaction_history" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"targetId" character varying(32) NOT NULL,
				"targetType" character varying(32) NOT NULL,
				"interactionType" character varying(32) NOT NULL,
				"weight" real NOT NULL DEFAULT 1.0,
				"duration" integer,
				"context" jsonb NOT NULL DEFAULT '{}',
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"implicit" boolean NOT NULL DEFAULT false,
				"relevanceScore" real,
				CONSTRAINT "PK_user_interaction_history" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_userId" ON "user_interaction_history" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_targetId" ON "user_interaction_history" ("targetId")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_targetType" ON "user_interaction_history" ("targetType")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_interactionType" ON "user_interaction_history" ("interactionType")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_createdAt" ON "user_interaction_history" ("createdAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_interaction_history_userId_targetType" ON "user_interaction_history" ("userId", "targetType")`);
		await queryRunner.query(`
			ALTER TABLE "user_recommendation_profile"
			ADD CONSTRAINT "FK_user_recommendation_profile_userId"
			FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
		`);
		await queryRunner.query(`
			ALTER TABLE "content_recommendation_log"
			ADD CONSTRAINT "FK_content_recommendation_log_userId"
			FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
		`);
		await queryRunner.query(`
			ALTER TABLE "content_recommendation_log"
			ADD CONSTRAINT "FK_content_recommendation_log_noteId"
			FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION
		`);
		await queryRunner.query(`
			ALTER TABLE "user_interaction_history"
			ADD CONSTRAINT "FK_user_interaction_history_userId"
			FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
		`);
        await queryRunner.query(`
            CREATE INDEX "IDX_user_interaction_history_recent"
                ON "user_interaction_history" ("createdAt", "userId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_content_recommendation_log_recent"
                ON "content_recommendation_log" ("createdAt", "userId")
        `);
	}

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_interaction_history" DROP CONSTRAINT "FK_user_interaction_history_userId"`);
        await queryRunner.query(`ALTER TABLE "content_recommendation_log" DROP CONSTRAINT "FK_content_recommendation_log_noteId"`);
        await queryRunner.query(`ALTER TABLE "content_recommendation_log" DROP CONSTRAINT "FK_content_recommendation_log_userId"`);
        await queryRunner.query(`ALTER TABLE "user_recommendation_profile" DROP CONSTRAINT "FK_user_recommendation_profile_userId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_recent"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_recent"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_userId_targetType"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_createdAt"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_interactionType"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_targetType"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_targetId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_history_userId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_engaged"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_context"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_createdAt"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_noteId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_recommendation_log_userId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_recommendation_profile_lastLearningUpdate"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_recommendation_profile_userId"`)
        await queryRunner.query(`DROP TABLE "user_interaction_history"`);
        await queryRunner.query(`DROP TABLE "content_recommendation_log"`);
        await queryRunner.query(`DROP TABLE "user_recommendation_profile"`);
    }
}
