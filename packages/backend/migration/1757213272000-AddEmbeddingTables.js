/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddEmbeddingTables1757213272000 {
    name = 'AddEmbeddingTables1757213272000';

    async up(queryRunner) {
        await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');

        await queryRunner.query(`
            CREATE TABLE "content_embedding" (
                "id" character varying(32) NOT NULL,
                "contentHash" character varying(64) NOT NULL,
                "embedding" real[] NOT NULL,
                "modelVersion" character varying(32) NOT NULL DEFAULT 'distiluse-v1',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_content_embedding" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_content_embedding_hash_model" ON "content_embedding" ("contentHash", "modelVersion")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_content_embedding_created_at" ON "content_embedding" ("createdAt")
        `);

        await queryRunner.query(`
            CREATE TABLE "user_interest_embedding" (
                "id" character varying(32) NOT NULL,
                "userId" character varying(32) NOT NULL,
                "embedding" real[] NOT NULL,
                "modelVersion" character varying(32) NOT NULL DEFAULT 'distiluse-v1',
                "lastUpdate" TIMESTAMP NOT NULL DEFAULT now(),
                "interactionCount" integer NOT NULL DEFAULT 0,
                CONSTRAINT "PK_user_interest_embedding" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_user_interest_embedding_user_model" ON "user_interest_embedding" ("userId", "modelVersion")
        `);

        await queryRunner.query(`
            ALTER TABLE "user_interest_embedding" ADD CONSTRAINT "FK_user_interest_embedding_user"
            FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TABLE "embedding_batch_queue" (
                "id" character varying(32) NOT NULL,
                "contentId" character varying(32) NOT NULL,
                "contentText" text NOT NULL,
                "contentHash" character varying(64) NOT NULL,
                "priority" integer NOT NULL DEFAULT 1,
                "status" character varying(20) NOT NULL DEFAULT 'pending',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "processedAt" TIMESTAMP NULL,
                CONSTRAINT "PK_embedding_batch_queue" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_embedding_batch_queue_status_priority" ON "embedding_batch_queue" ("status", "priority", "createdAt")
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_embedding_batch_queue_status_priority"`);
        await queryRunner.query(`DROP TABLE "embedding_batch_queue"`);

        await queryRunner.query(`ALTER TABLE "user_interest_embedding" DROP CONSTRAINT "FK_user_interest_embedding_user"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interest_embedding_user_model"`);
        await queryRunner.query(`DROP TABLE "user_interest_embedding"`);

        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_embedding_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_embedding_hash_model"`);
        await queryRunner.query(`DROP TABLE "content_embedding"`);

        await queryRunner.query('DROP EXTENSION IF EXISTS vector');
    }
}
